"""Decode official JSON ZIP attachments in memory; never extract paths to disk."""
import io, json, sys, zipfile
budget = 64 * 1024 * 1024
rows = []
def walk(data):
    if isinstance(data, list):
        for x in data: walk(x)
    elif isinstance(data, dict):
        if 'stanowisko' in data and 'link' in data: rows.append(data)
        else:
            for x in data.values(): walk(x)
def unpack(data, depth=0):
    global budget
    if depth > 2: raise ValueError('nested ZIP depth exceeded')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for info in archive.infolist():
            if info.is_dir(): continue
            budget -= info.file_size
            if budget < 0: raise ValueError('uncompressed size limit exceeded')
            if info.filename.lower().endswith('.zip'): unpack(archive.read(info),depth+1)
            elif info.filename.lower().endswith('.json'): walk(json.loads(archive.read(info)))
unpack(sys.stdin.buffer.read(32 * 1024 * 1024))
json.dump(rows,sys.stdout,ensure_ascii=False)
