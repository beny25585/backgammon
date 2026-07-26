"""
Backgammon Game Engine - Pure game logic
Matches frontend engine at src/lib/backgammon/engine.ts
"""

import random


class BackgammonEngine:
    def __init__(self, state=None):
        self.state = state or self.get_initial_state()

    @staticmethod
    def get_initial_state():
        p = [0] * 24
        # Standard backgammon starting position
        # White (positive): 2 on 23, 5 on 12, 3 on 7, 5 on 5
        # Black (negative): 2 on 0, 5 on 11, 3 on 16, 5 on 18
        p[23] = 2   # white
        p[12] = 5
        p[7] = 3
        p[5] = 5
        p[0] = -2   # black
        p[11] = -5
        p[16] = -3
        p[18] = -5
        return {
            'points': p,
            'bar': {'white': 0, 'black': 0},
            'home': {'white': 0, 'black': 0},
            'turn': 'white',
            'dice': [],
            'remaining': [],
            'phase': 'opening_roll',
            'cube': 1,
            'cubeOwner': 'center',
            'doubleOfferedBy': None,
            'winner': None,
            'winType': None,
            'openingRoll': {'white': None, 'black': None},
            'lastMove': None,
            'moveHistory': None,
            'message': 'New game started',
        }

    @staticmethod
    def _roll_die():
        return random.randint(1, 6)

    @staticmethod
    def _clone_state(state):
        """Deep-copy a game state dict."""
        return {
            'points': list(state['points']),
            'bar': dict(state['bar']),
            'home': dict(state['home']),
            'turn': state['turn'],
            'dice': list(state['dice']),
            'remaining': list(state['remaining']),
            'phase': state['phase'],
            'cube': state['cube'],
            'cubeOwner': state['cubeOwner'],
            'doubleOfferedBy': state['doubleOfferedBy'],
            'winner': state['winner'],
            'winType': state['winType'],
            'openingRoll': dict(state['openingRoll']),
            'lastMove': None if state.get('lastMove') is None else [dict(m) for m in state['lastMove']],
            'moveHistory': None,
            'message': state['message'],
        }

    @staticmethod
    def _roll_dice():
        a = BackgammonEngine._roll_die()
        b = BackgammonEngine._roll_die()
        return [a, a, a, a] if a == b else [a, b]

    @staticmethod
    def _direction(color):
        return -1 if color == 'white' else 1

    def _owns_point(self, idx, color):
        v = self.state['points'][idx]
        return v > 0 if color == 'white' else v < 0

    def _opponent_blot(self, idx, color):
        v = self.state['points'][idx]
        return v == -1 if color == 'white' else v == 1

    def _opponent_point(self, idx, color):
        v = self.state['points'][idx]
        return v <= -2 if color == 'white' else v >= 2

    def _all_in_home(self, color):
        if self.state['bar'][color] > 0:
            return False
        rng = (0, 5) if color == 'white' else (18, 23)
        count = 0
        for i in range(24):
            owns = self.state['points'][i] > 0 if color == 'white' else self.state['points'][i] < 0
            if owns:
                if i < rng[0] or i > rng[1]:
                    return False
                count += abs(self.state['points'][i])
        return count + self.state['home'][color] == 15

    def _highest_occupied(self, color):
        if color == 'white':
            for i in range(5, -1, -1):
                if self.state['points'][i] > 0:
                    return i
        else:
            for i in range(18, 24):
                if self.state['points'][i] < 0:
                    return i
        return -1

    def legal_moves_from(self, from_pt, color):
        moves = []
        dice = list(set(self.state['remaining']))
        direc = self._direction(color)

        if self.state['bar'][color] > 0 and from_pt != 'bar':
            return []

        if from_pt == 'bar':
            for d in dice:
                entry = 24 - d if color == 'white' else d - 1
                if entry < 0 or entry > 23:
                    continue
                if not self._opponent_point(entry, color):
                    moves.append({'from': 'bar', 'to': entry, 'die': d})
            return moves

        if not self._owns_point(from_pt, color):
            return []

        for d in dice:
            to = from_pt + direc * d
            if 0 <= to <= 23:
                if not self._opponent_point(to, color):
                    moves.append({'from': from_pt, 'to': to, 'die': d})
            else:
                if not self._all_in_home(color):
                    continue
                distance = from_pt + 1 if color == 'white' else 24 - from_pt
                if d == distance:
                    moves.append({'from': from_pt, 'to': 'off', 'die': d})
                elif d > distance:
                    hi = self._highest_occupied(color)
                    is_highest = (color == 'white' and from_pt == hi) or (color != 'white' and from_pt == hi)
                    if is_highest:
                        moves.append({'from': from_pt, 'to': 'off', 'die': d})
        return moves

    def all_legal_moves(self, color):
        out = []
        if self.state['bar'][color] > 0:
            return self.legal_moves_from('bar', color)
        for i in range(24):
            if self._owns_point(i, color):
                out.extend(self.legal_moves_from(i, color))
        return out

    def roll_dice(self):
        if self.state['phase'] != 'rolling':
            return {'success': False, 'message': 'Cannot roll now'}
        roll = self._roll_dice()
        self.state['dice'] = [roll[0], roll[1]] if len(roll) == 4 else [roll[0], roll[1]]
        self.state['remaining'] = roll
        self.state['phase'] = 'moving'
        self.state['lastMove'] = []
        self.state['moveHistory'] = []

        if len(self.all_legal_moves(self.state['turn'])) == 0:
            self.state['remaining'] = []
            self.state['turn'] = 'black' if self.state['turn'] == 'white' else 'white'
            self.state['phase'] = 'rolling'
            self.state['message'] = 'No legal moves'
        else:
            turn_he = 'לבן' if self.state['turn'] == 'white' else 'שחור'
            self.state['message'] = f'תור {turn_he}'

        self.state['version'] = self.state.get('version', 0) + 1
        return {'dice': self.state['dice'], 'remaining': self.state['remaining']}

    def apply_opening_roll(self, player_color):
        s = self.state
        if s['openingRoll'].get(player_color) is not None:
            return {'success': False, 'message': 'Already rolled'}
        roll = self._roll_die()
        s['openingRoll'][player_color] = roll
        s['version'] = s.get('version', 0) + 1
        white = s['openingRoll'].get('white')
        black = s['openingRoll'].get('black')
        if white is not None and black is not None:
            if white == black:
                s['openingRoll'] = {'white': None, 'black': None}
                s['message'] = 'Tie — roll again'
                return {'success': True, 'dice': [roll], 'tie': True}
            else:
                first = 'white' if white > black else 'black'
                s['turn'] = first
                s['dice'] = [white, black]
                s['remaining'] = [white, black]
                s['phase'] = 'moving'
                s['lastMove'] = []
                s['moveHistory'] = []
                s['openingRoll'] = {'white': white, 'black': black}
                s['message'] = f'{first} goes first'
                s['version'] = s.get('version', 0) + 1
                return {'success': True, 'dice': [roll], 'winner': first, 'both': [white, black]}
        return {'success': True, 'dice': [roll], 'waiting': True}

    def make_move(self, from_point, to_point, player_color):
        if self.state['turn'] != player_color:
            return {'success': False, 'message': 'Not your turn'}

        if isinstance(to_point, int) and to_point < 0:
            to_point = 'off'

        from_pt = from_point
        to_pt = to_point

        moves = self.legal_moves_from(from_pt, player_color)
        matching = [m for m in moves if m['to'] == to_pt]
        if not matching:
            return {'success': False, 'message': 'Invalid move'}

        move = matching[0]
        self._apply_move(move, player_color)
        self.state['version'] = self.state.get('version', 0) + 1
        return {'success': True, 'message': 'Move executed', 'state': self.state}

    def _apply_move(self, move, color):
        s = self.state
        die_val = move['die']

        # Save pre-move snapshot for undo
        if s.get('moveHistory') is None:
            s['moveHistory'] = []
        s['moveHistory'].append(self._clone_state(self.state))

        if die_val in s['remaining']:
            s['remaining'].remove(die_val)

        if move['from'] == 'bar':
            s['bar'][color] -= 1
        else:
            s['points'][move['from']] += -1 if color == 'white' else 1

        if move['to'] == 'off':
            s['home'][color] += 1
        else:
            if self._opponent_blot(move['to'], color):
                opp = 'black' if color == 'white' else 'white'
                s['points'][move['to']] = 0
                s['bar'][opp] += 1
            s['points'][move['to']] += 1 if color == 'white' else -1

        s['lastMove'] = (s['lastMove'] or []) + [{'from': move['from'], 'to': move['to']}]

        if s['home'][color] == 15:
            s['winner'] = color
            opp = 'black' if color == 'white' else 'white'
            if s['home'][opp] == 0:
                opp_on_bar = s['bar'][opp] > 0
                winner_home = (0, 5) if color == 'white' else (18, 23)
                opp_in_winner_home = False
                for i in range(winner_home[0], winner_home[1] + 1):
                    if (opp == 'white' and s['points'][i] > 0) or (opp != 'white' and s['points'][i] < 0):
                        opp_in_winner_home = True
                        break
                s['winType'] = 'backgammon' if (opp_on_bar or opp_in_winner_home) else 'gammon'
            else:
                s['winType'] = 'single'
            s['phase'] = 'game_over'
            s['message'] = 'Game over'
            return

        if len(s['remaining']) == 0:
            # All dice used — stay in moving, wait for confirm
            s['message'] = 'אשר סיום תור'
            return

        if len(self.all_legal_moves(color)) == 0:
            s['remaining'] = []
            s['turn'] = 'black' if color == 'white' else 'white'
            s['phase'] = 'rolling'
            s['dice'] = []
            s['lastMove'] = None
            s['moveHistory'] = None
            turn_he = 'לבן' if s['turn'] == 'white' else 'שחור'
            s['message'] = f'תור {turn_he}'

    def offer_double(self, player_color):
        if self.state['cubeOwner'] != 'center' and self.state['cubeOwner'] != player_color:
            return {'success': False, 'message': 'Cannot double'}
        if self.state['phase'] != 'rolling':
            return {'success': False, 'message': 'Can only double before rolling'}
        if self.state['cube'] >= 64:
            return {'success': False, 'message': 'Cube at maximum'}

        self.state['phase'] = 'doubling_offered'
        self.state['doubleOfferedBy'] = player_color
        self.state['version'] = self.state.get('version', 0) + 1
        return {'success': True, 'message': 'Double offered'}

    def respond_to_double(self, accept, player_color):
        offerer = self.state['doubleOfferedBy']
        opponent = 'black' if offerer == 'white' else 'white'

        if player_color != opponent:
            return {'success': False, 'message': 'Not your double to respond to'}
        if self.state['phase'] != 'doubling_offered':
            return {'success': False, 'message': 'No double to respond to'}

        if accept:
            self.state['cube'] *= 2
            self.state['cubeOwner'] = opponent
            self.state['phase'] = 'rolling' if len(self.state['dice']) == 0 else 'moving'
            self.state['doubleOfferedBy'] = None
        else:
            self.state['winner'] = offerer
            self.state['winType'] = 'single'
            self.state['phase'] = 'game_over'
            self.state['doubleOfferedBy'] = None

        self.state['version'] = self.state.get('version', 0) + 1
        return {'success': True}

    def end_turn(self):
        self.state['remaining'] = []
        self.state['turn'] = 'black' if self.state['turn'] == 'white' else 'white'
        self.state['phase'] = 'rolling'
        self.state['dice'] = []
        self.state['lastMove'] = None
        self.state['moveHistory'] = None
        self.state['version'] = self.state.get('version', 0) + 1
        return {'success': True, 'state': self.state}

    def undo_move(self):
        s = self.state
        history = s.get('moveHistory')
        if not history or len(history) == 0:
            return {'success': False, 'message': 'Nothing to undo'}
        # Restore the last snapshot, trimming popped entry
        s.clear()
        restored = history[-1]
        restored['moveHistory'] = history[:-1] or None
        self.state = restored
        return {'success': True, 'state': self.state}

    def check_win_condition(self):
        if self.state.get('winner'):
            return self.state['winner']
        for color in ['white', 'black']:
            if self.state['home'][color] == 15:
                return color
        return None
