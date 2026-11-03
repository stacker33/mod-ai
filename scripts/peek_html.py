import re, sys
sys.stdout.reconfigure(encoding='utf-8')
s = open(sys.argv[1], encoding='utf-8').read()
idx = [m.start() for m in re.finditer(r'<p[ >]', s)]
print(len(idx))
if idx:
    print(s[idx[0] - 1500:idx[0] + 700])
