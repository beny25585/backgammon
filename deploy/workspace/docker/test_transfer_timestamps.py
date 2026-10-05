"""Timestamp regressions for the transfer tool; no database connection is used."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tournaments_transfer import (
    canonical_datetime,
    read_bundle,
    serialize_records,
    summarize,
)


class TransferTimestampTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import django
        from django.conf import settings

        settings.configure(USE_TZ=True, INSTALLED_APPS=["django.contrib.sessions"])
        django.setup()
        from django.contrib.sessions.models import Session

        cls.model = Session

    def records(self, expiry):
        return [
            {
                "model": "sessions.session",
                "pk": "synthetic_session",
                "fields": {"session_data": "synthetic_payload", "expire_date": expiry},
            }
        ]

    def test_same_instant_matches_across_fraction_and_offset_formats(self):
        expected = summarize(self.records("2026-10-17T13:13:09Z"), self.model)
        for expiry in (
            "2026-10-17T13:13:09.000Z",
            "2026-10-17T13:13:09.000000+00:00",
            "2026-10-17T16:13:09+03:00",
        ):
            with self.subTest(expiry=expiry):
                self.assertEqual(summarize(self.records(expiry), self.model), expected)

    def test_microseconds_survive_fixture_roundtrip(self):
        from django.core import serializers

        for microseconds in (0, 500, 123456):
            with self.subTest(microseconds=microseconds):
                expiry = datetime(
                    2030,
                    10,
                    17,
                    16,
                    13,
                    9,
                    microsecond=microseconds,
                    tzinfo=timezone(timedelta(hours=3)),
                )
                session = self.model(
                    session_key="synthetic_session",
                    session_data="synthetic_payload",
                    expire_date=expiry,
                )
                fixture = serialize_records([session])
                restored = list(serializers.deserialize("json", fixture))[0].object
                self.assertEqual(restored.expire_date, expiry)
                self.assertEqual(restored.expire_date.microsecond, microseconds)
                self.assertEqual(restored.session_data, session.session_data)
                self.assertEqual(
                    json.loads(fixture)[0]["fields"]["expire_date"],
                    canonical_datetime(expiry),
                )

    def test_changed_instant_or_payload_changes_fingerprint(self):
        original = self.records("2026-10-17T13:13:09.000500Z")
        expected = summarize(original, self.model)["sha256"]
        changed_time = self.records("2026-10-17T13:13:09.000501Z")
        self.assertNotEqual(summarize(changed_time, self.model)["sha256"], expected)
        changed_payload = self.records("2026-10-17T13:13:09.000500Z")
        changed_payload[0]["fields"]["session_data"] = "changed_payload"
        self.assertNotEqual(summarize(changed_payload, self.model)["sha256"], expected)

    def test_naive_timestamp_is_refused(self):
        with self.assertRaisesRegex(ValueError, "must include a timezone"):
            canonical_datetime("2026-10-17T13:13:09")

    def test_old_bundle_requires_new_export(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            (path / "manifest.json").write_text(json.dumps({"format": 1}))
            with self.assertRaisesRegex(
                ValueError, "Re-export the original SQLite snapshot"
            ):
                read_bundle(path)


if __name__ == "__main__":
    unittest.main()
