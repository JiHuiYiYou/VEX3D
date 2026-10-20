"""Read the STEP once and build the on-disk cache used by all later steps.

Reading + transferring the 126 MB STEP takes ~8 minutes; the cache makes
every later run (measurement, export) start in seconds.  Re-run with
--force to rebuild.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import steplib  # noqa: E402


def main():
    force = "--force" in sys.argv
    t0 = time.time()
    steplib.plan_log(f"STEP: {steplib.STEP_PATH}")
    if not force and steplib.cache_is_complete():
        steplib.plan_log("cache already complete -- nothing to do")
        return 0
    doc = steplib.read_step(steplib.STEP_PATH, progress=steplib.plan_log)
    steplib.plan_log(f"read done at {time.time()-t0:.1f}s")
    steplib.build_cache(doc, progress=steplib.plan_log)
    steplib.plan_log(f"TOTAL {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
