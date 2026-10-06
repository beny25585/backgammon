"""Compatibility for tasks queued before analysis moved to its package."""
from .analysis.outbox import (
    deliver_analysis as deliver_analysis,
    enqueue_match_analysis as enqueue_match_analysis,
    try_deliver_analysis_now as try_deliver_analysis_now,
)
