"""Rules carried by signed game and tournament contracts."""
CONTRACT_KEYS = ('gameFormat', 'maxCube', 'jacoby', 'stake', 'lossLimit',
                 'doublingAllowed', 'crawfordEnabled', 'crawfordGame', 'crawfordUsed')


def forfeit_win_type(state, loser, fallback='single', *, reason='leave'):
    """Classify a forfeit independently of cube/Jacoby scoring and series closure.

    Signed money games use the board for every unilateral exit. In a signed
    match only giving up the current game uses the board; abandoning the series
    still closes it with the existing fallback. Unversioned games retain their
    existing policy. A cube refusal always loses one unit of the old cube.
    """
    if reason == 'drop':
        return 'single'
    game_format = state.get('gameFormat')
    board_result = (
        game_format == 'money' and reason in {'give_up', 'leave', 'time', 'disconnect', 'inactivity_timeout'}
    ) or (game_format == 'match' and reason == 'give_up')
    if not board_result:
        return fallback
    if state.get('home', {}).get(loser, 0) > 0:
        return 'single'
    points = state.get('points', [0] * 24)
    winner_home = points[18:24] if loser == 'white' else points[:6]
    in_home = any(point > 0 if loser == 'white' else point < 0 for point in winner_home)
    return 'backgammon' if state.get('bar', {}).get(loser, 0) or in_home else 'gammon'


def apply_ticket(state, ticket):
    state['doublingEnabled'] = bool(ticket.get('dbl', True))
    tournament_match = (
        'format' not in ticket
        and ticket.get('trn', 0) > 0
        and ticket.get('fix', 0) > 0
    )
    if 'format' not in ticket and not tournament_match:
        return
    if tournament_match:
        # Tournament tickets carry match rules without a direct-game stake contract.
        state['crawfordEnabled'] = True
    else:
        state.update(gameFormat=ticket['format'], maxCube=ticket['cube_max'],
                     jacoby=ticket['jacoby'], stake=ticket['stake'],
                     lossLimit=ticket['loss_limit'])
    state.update(doublingAllowed=state['doublingEnabled'],
                 crawfordGame=(tournament_match or ticket.get('format') == 'match') and ticket['tp'] == 1,
                 crawfordUsed=False)
    if state['crawfordGame']:
        state['doublingEnabled'] = False


def carry_contract(previous, fresh, room):
    fresh.update({key: previous[key] for key in CONTRACT_KEYS if key in previous})
    fresh['doublingEnabled'] = previous.get('doublingEnabled', True)
    if previous.get('gameFormat') == 'match' or previous.get('crawfordEnabled', False):
        used = previous.get('crawfordUsed', False) or previous.get('crawfordGame', False)
        crawford = not used and room.target_points - 1 in (room.white_score, room.black_score)
        fresh.update(crawfordUsed=used, crawfordGame=crawford,
                     doublingEnabled=previous.get('doublingAllowed', True) and not crawford)
