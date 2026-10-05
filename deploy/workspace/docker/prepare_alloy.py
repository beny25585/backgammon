"""Create an Alloy candidate without replacing or restarting the active configuration."""

import argparse
import os
import re
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=Path("/etc/alloy-config.hcl"))
    parser.add_argument(
        "--snippet",
        type=Path,
        default=Path(__file__).with_name("alloy.backgammon-docker.hcl"),
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--include-metrics", action="store_true")
    args = parser.parse_args()
    source = args.source.read_text(encoding="utf-8")
    addition = args.snippet.read_text(encoding="utf-8")
    if args.output.resolve() == args.source.resolve():
        raise ValueError(
            "The output must be a new candidate, not the active configuration."
        )
    logs_exist = "BEGIN BACKGAMMON DOCKER LOGS" in source or re.search(
        r'(?:discovery\.docker|discovery\.relabel|loki\.source\.docker)\s+"backgammon_production"',
        source,
    )
    if logs_exist and not args.include_metrics:
        raise ValueError(
            "Backgammon Docker collection already exists; do not append it twice."
        )
    if not re.search(r'loki\.write\s+"local"\s*\{', source):
        raise ValueError("The existing loki.write.local receiver was not found.")
    if "BEGIN BACKGAMMON DOCKER LOGS" not in addition:
        raise ValueError("Expected the reviewed Backgammon Docker addition.")
    additions = [] if logs_exist else [addition]
    if args.include_metrics:
        if "BEGIN BACKGAMMON METRICS" in source or re.search(
            r'prometheus\.remote_write\s+"backgammon_metrics"', source
        ):
            raise ValueError(
                "Backgammon metrics already exist; do not append them twice."
            )
        metrics = (
            Path(__file__)
            .with_name("alloy.backgammon-metrics.hcl")
            .read_text(encoding="utf-8")
        )
        if "BEGIN BACKGAMMON METRICS" not in metrics:
            raise ValueError("Expected the reviewed Backgammon metrics addition.")
        additions.append(metrics)
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(source.rstrip() + "\n\n" + "\n\n".join(additions))
    print(
        "Candidate saved privately; active Alloy configuration and service are unchanged."
    )


if __name__ == "__main__":
    main()
