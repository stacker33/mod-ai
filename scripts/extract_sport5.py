# Pull the article text out of saved Sport5 pages (style examples, internal use only).
# usage: python -I scripts/extract_sport5.py <in.html> <out.txt>
import html, re, sys

sys.stdout.reconfigure(encoding='utf-8')
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()


def clean(fragment):
    t = re.sub(r'<(script|style|iframe)[^>]*>.*?</\1>', ' ', fragment, flags=re.S | re.I)
    t = re.sub(r'<br\s*/?>', '\n', t, flags=re.I)
    t = re.sub(r'</(p|h1|h2|h3|li|div)>', '\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', '', t)
    t = html.unescape(t).replace('\xa0', ' ')
    lines = [re.sub(r'[ \t\r]+', ' ', x).strip() for x in t.split('\n')]
    out, blank = [], False
    for x in lines:
        if x:
            out.append(x)
            blank = False
        elif not blank:
            out.append('')
            blank = True
    return '\n'.join(out).strip()


title = re.search(r'<title>(.*?)</title>', s, re.S)
title = clean(title.group(1)) if title else ''
url = re.search(r'<link rel="canonical" href="([^"]+)"', s)
if 'find-article-content' in s:
    h1 = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S)
    h2 = re.search(r'<h2[^>]*>(.*?)</h2>', s, re.S)
    start = s.index('id="find-article-content"')
    end_marks = [s.find(m, start) for m in ('article-tags', 'id="taboola-below-article', 'class="tags', 'ShareButtons', 'comments')]
    end = min([e for e in end_marks if e > 0] or [start + 40000])
    body = clean(s[start:end].split('>', 1)[1])
    head = '\n'.join(x for x in [clean(h1.group(1)) if h1 else '', clean(h2.group(1)) if h2 else ''] if x)
    text = f'{head}\n\n{body}'
else:
    start = s.index('class="headerTextdaka"')
    end_marks = [s.find(m, start) for m in ('id="taboola', 'class="aside', '<footer', 'Mako Start')]
    end = min([e for e in end_marks if e > 0] or [start + 80000])
    text = clean(s[start:end].split('>', 1)[1])

open(dst, 'w', encoding='utf-8', newline='\n').write(f'# {title}\n# {url.group(1) if url else src}\n\n{text}\n')
print(dst, len(text))
