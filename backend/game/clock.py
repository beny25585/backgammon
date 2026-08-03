"""Server-side chess-clock helpers. Mirrors frontend/src/lib/clock.ts."""


def parse_time_control(preset_id):
    """Return (base_ms, bonus_ms) for a preset id like '3+10', else None.

    'none', missing, or malformed ids mean no time limit.
    """
    if not preset_id or preset_id == 'none':
        return None
    try:
        minutes, bonus_sec = preset_id.split('+')
        return (int(minutes) * 60_000, int(bonus_sec) * 1_000)
    except (ValueError, AttributeError):
        return None


def active_player(state):
    """The color whose clock should tick, or None when the clock is stopped.

    - waiting / game_over        -> stopped
    - doubling_offered           -> the responder decides, so they pay time
    - otherwise                  -> whoever's turn it is
    """
    if not state:
        return None
    phase = state.get('phase')
    if phase in ('waiting', 'game_over'):
        return None
    if phase == 'doubling_offered' and state.get('doubleOfferedBy'):
        return 'black' if state['doubleOfferedBy'] == 'white' else 'white'
    return state.get('turn')


def apply_transition(clock, prev_active, new_active, elapsed_ms, bonus_ms):
    """Charge the outgoing player and grant their bonus on a turn change."""
    result = dict(clock)
    if prev_active and prev_active != new_active:
        result[prev_active] = max(0, result.get(prev_active, 0) - elapsed_ms) + bonus_ms
    return result


def compute_clock(stored, incoming, now_ms, preset_id):
    """Server-owned clock computation.

    Returns (clock, turn_started_at, active, timed_out). When there is no time
    limit, returns (None, None, None, False). `stored` is the previously saved
    state; `incoming` is the state the client just sent. Client-provided clock
    values are never trusted.
    """
    tc = parse_time_control(preset_id)
    if tc is None:
        return None, None, None, False
    base_ms, bonus_ms = tc

    clock = dict(stored.get('clock') or {'white': base_ms, 'black': base_ms})
    turn_started_at = stored.get('turnStartedAt')
    new_active = active_player(incoming)
    timed_out = False

    if turn_started_at is None:
        # First action of the game: seed both clocks, clock starts now.
        clock = {'white': base_ms, 'black': base_ms}
        turn_started_at = now_ms
    elif stored.get('phase') == 'game_over' and incoming.get('phase') != 'game_over':
        # New game after a finished one: restart both clocks.
        clock = {'white': base_ms, 'black': base_ms}
        turn_started_at = now_ms
    else:
        stored_active = active_player(stored)
        if stored_active and new_active and stored_active != new_active:
            elapsed = max(0, now_ms - turn_started_at)
            clock = apply_transition(clock, stored_active, new_active, elapsed, bonus_ms)
            turn_started_at = now_ms

    if new_active and clock.get(new_active, 0) <= 0:
        timed_out = True

    return clock, turn_started_at, new_active, timed_out
