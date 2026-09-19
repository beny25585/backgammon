# Background tasks — current operation

Reviewed: 2026-09-19. The filename is retained for existing links. Django-Q is **not** listed in backend/requirements.txt and is not the current task runner; older installation instructions described an optional proposal.

## Current commands

Run these from the game backend environment:

~~~sh
python manage.py run_tasks
python manage.py expire_waiting_rooms
python manage.py purge_redeemed_tickets
python manage.py check_delivery_health
~~~

run_tasks processes a batch of up to 50 due Task records and returns. Schedule it repeatedly (the deployment runbook uses one to a few seconds), rather than starting it once and assuming a daemon remains running. game/task_runner.py handles leases, retries and failures requiring review.

expire_waiting_rooms calls game/tasks.py. Linked rooms are reported before closure: a single occupied seat may generate a forfeit; other expired-room shapes can cancel without choosing a winner. Do not replace this with a bulk database delete.

The tournament backend separately runs run_push_notifications and deliver_admin_game_commands; the analysis service runs process_analyses. None of these is started automatically by run_tasks. [Deployment](../../backgammon-tournaments-backend/DEPLOY_GAME_AND_CLUB.he.md).

No scheduler was installed or verified by this documentation update.
