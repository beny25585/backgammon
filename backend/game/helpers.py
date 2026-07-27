def extract_transcript(state_data):
    """Convert engine moveHistory into transcript format."""
    history = state_data.get('moveHistory', []) if state_data else []
    if not history:
        return []
    transcript = []
    current_entry = None
    current_color = None
    for entry in history:
        turn_color = entry.get('player', entry.get('turn'))
        if not turn_color:
            continue
        if turn_color != current_color:
            if current_entry:
                transcript.append(current_entry)
            current_color = turn_color
            current_entry = {
                'turn': turn_color,
                'roll': list(entry.get('dice', entry.get('roll', []))),
                'moves': [],
            }
        current_entry['moves'].append({
            'from': entry.get('from'),
            'to': entry.get('to'),
        })
    if current_entry:
        transcript.append(current_entry)
    return transcript
