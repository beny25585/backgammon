"""Rules carried by the signed game contract, independent of matchmaking."""
CONTRACT_KEYS = ('gameFormat', 'maxCube', 'jacoby', 'stake', 'lossLimit',
                 'doublingAllowed', 'crawfordGame', 'crawfordUsed')


def forfeit_win_type(state, loser, fallback='single'):
    """A unilateral money-game exit cannot erase a current gammon/backgammon."""
    if state.get('gameFormat') != 'money':
        return fallback
    if state.get('home', {}).get(loser, 0) > 0:
        return 'single'
    points = state.get('points', [0] * 24)
    winner_home = points[18:24] if loser == 'white' else points[:6]
    in_home = any(point > 0 if loser == 'white' else point < 0 for point in winner_home)
    return 'backgammon' if state.get('bar', {}).get(loser, 0) or in_home else 'gammon'


def apply_ticket(state, ticket):
    state['doublingEnabled'] = bool(ticket.get('dbl', True))
    if 'format' not in ticket:
        return
    state.update(gameFormat=ticket['format'], maxCube=ticket['cube_max'],
                 jacoby=ticket['jacoby'], stake=ticket['stake'],
                 lossLimit=ticket['loss_limit'], doublingAllowed=state['doublingEnabled'],
                 crawfordGame=ticket['format'] == 'match' and ticket['tp'] == 1,
                 crawfordUsed=False)
    if state['crawfordGame']:
        state['doublingEnabled'] = False


def carry_contract(previous, fresh, room):
    fresh.update({key: previous[key] for key in CONTRACT_KEYS if key in previous})
    fresh['doublingEnabled'] = previous.get('doublingEnabled', True)
    if previous.get('gameFormat') == 'match':
        used = previous.get('crawfordUsed', False) or previous.get('crawfordGame', False)
        crawford = not used and room.target_points - 1 in (room.white_score, room.black_score)
        fresh.update(crawfordUsed=used, crawfordGame=crawford,
                     doublingEnabled=previous.get('doublingAllowed', True) and not crawford)
