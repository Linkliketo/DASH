

def ensure_parent(file_path):
    file_path.parent.mkdir(parents=True, exist_ok=True)