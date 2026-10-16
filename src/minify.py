#!/usr/bin/env python3
"""Strip what does not run: comments, indentation and blank lines, per language.

    python3 minify.py file.js|.css|.html   -> stdout

Used by build.py --dist to produce the clean deliverable. The output must be the
SAME program: only comments and insignificant whitespace go. So this is not a
regex pass — a `//` inside a URL string, a `/*` inside a template literal or a
`/` that starts a regex would all break under one. It is a small scanner that
knows, at every character, whether it stands in code, a string, a template
literal (and how deep inside its `${}`), a regex literal or a comment, and only
touches code.

Two details that are easy to get wrong:

- A block comment that spans lines is replaced by a NEWLINE, not a space. To
  the parser a comment with a line break inside IS a line terminator, and
  automatic semicolon insertion reads it as one; `return /* … \\n … */ x`
  returns undefined and must go on doing so.
- Indentation inside a multi-line template literal is content, not layout.
  Only whitespace met in code state is dropped.

The regex-or-division question is decided the usual way, from what came just
before the slash: after a value (identifier, number, `)`, `]`, `}`) it divides,
after an operator, a bracket or a keyword like `return` it starts a regex.
build.py --dist runs `node --check` on the result, and the assembly was proved
once against a real parser (acorn): same AST, comments aside.
"""
import sys
from pathlib import Path

# After one of these words a `/` starts a regex, not a division.
_REGEX_KEYWORDS = {'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete',
                   'void', 'throw', 'case', 'do', 'else', 'yield', 'await'}
_IDENT = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$')


def minify_js(src):
    out = []
    i, n = 0, len(src)
    # `stack` holds one counter per open template literal: the brace depth of
    # the `${ … }` we are inside, or -1 while in the literal's text itself.
    stack = []
    last = ''         # last significant character emitted from code
    word = ''         # the identifier that character closed, if any
    at_line_start = True

    def code_ws_skip(j):
        """Eat spaces and tabs at j; return the index after them."""
        while j < n and src[j] in ' \t\r':
            j += 1
        return j

    def space():
        """One space between tokens, never two."""
        if out and out[-1] not in (' ', '\n'):
            out.append(' ')

    while i < n:
        c = src[i]
        in_template_text = stack and stack[-1] == -1

        if in_template_text:
            if c == '\\':
                out.append(src[i:i+2]); i += 2; continue
            if c == '`':
                stack.pop(); out.append(c); i += 1
                last = '`'; word = ''; at_line_start = False; continue
            if c == '$' and src.startswith('${', i):
                stack[-1] = 0; out.append('${'); i += 2
                last = '{'; word = ''; at_line_start = False; continue
            out.append(c); i += 1; continue

        # ---- code state ----
        if c == '\n':
            # Drop trailing whitespace already emitted on this line.
            while out and out[-1] in (' ', '\t'):
                out.pop()
            if not at_line_start:
                out.append('\n')
            at_line_start = True
            i = code_ws_skip(i + 1)
            continue
        if c in ' \t\r':
            j = code_ws_skip(i)
            if not at_line_start and j < n and src[j] != '\n':
                space()
            i = j
            continue
        if c == '/' and src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
            continue
        if c == '/' and src.startswith('/*', i):
            j = src.find('*/', i + 2)
            if j < 0:
                sys.exit('minify: unclosed /* comment')
            body = src[i:j+2]
            i = j + 2
            if '\n' in body:
                while out and out[-1] in (' ', '\t'):
                    out.pop()
                if not at_line_start:
                    out.append('\n')
                at_line_start = True
                i = code_ws_skip(i)
            elif not at_line_start:
                space()
            continue

        at_line_start = False

        if c in '\'"':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j+1]); i = j + 1
            last = c; word = ''; continue
        if c == '`':
            stack.append(-1); out.append(c); i += 1
            last = ''; word = ''; continue
        if c == '/':
            regex = (last == '' or last in '(,=:[!&|?{};+-*%<>~^'
                     or (last in _IDENT and word in _REGEX_KEYWORDS))
            if regex:
                j = i + 1; in_class = False
                while j < n:
                    d = src[j]
                    if d == '\\':
                        j += 2; continue
                    if in_class:
                        if d == ']': in_class = False
                    elif d == '[':
                        in_class = True
                    elif d == '/':
                        break
                    elif d == '\n':
                        sys.exit('minify: regex not closed on its line')
                    j += 1
                j += 1
                while j < n and src[j] in _IDENT:   # flags
                    j += 1
                out.append(src[i:j]); i = j
                last = '/'; word = ''; continue
            out.append(c); i += 1; last = '/'; word = ''; continue
        if stack and stack[-1] >= 0 and c in '{}':
            if c == '{':
                stack[-1] += 1
            elif stack[-1] == 0:
                stack[-1] = -1        # back into the template's text
                out.append(c); i += 1; last = '}'; word = ''; continue
            else:
                stack[-1] -= 1
        out.append(c); i += 1
        if c in _IDENT:
            word = (word + c) if last in _IDENT else c
        else:
            word = ''
        last = c

    while out and out[-1] in (' ', '\t', '\n'):
        out.pop()
    return ''.join(out) + '\n'


def minify_css(src):
    """Comments out, one line per line, no indentation. Strings survive."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '\'"':
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j+1]); i = j + 1; continue
        if src.startswith('/*', i):
            j = src.find('*/', i + 2)
            if j < 0:
                sys.exit('minify: unclosed CSS comment')
            i = j + 2; continue
        out.append(c); i += 1
    return _lines(''.join(out))


def minify_html(src):
    """Markup only — the pieces with code in them are .css and .js files.
    Comments out, indentation out; a newline between lines stays, so
    whitespace between inline elements is still whitespace."""
    out = []
    i, n = 0, len(src)
    while i < n:
        if src.startswith('<!--', i):
            j = src.find('-->', i + 4)
            if j < 0:
                sys.exit('minify: unclosed HTML comment')
            i = j + 3; continue
        out.append(src[i]); i += 1
    return _lines(''.join(out))


def _lines(s):
    lines = [l.strip() for l in s.split('\n')]
    return '\n'.join(l for l in lines if l) + '\n'


def minify(name, src):
    ext = Path(name).suffix
    if ext == '.js':   return minify_js(src)
    if ext == '.css':  return minify_css(src)
    if ext == '.html': return minify_html(src)
    sys.exit(f'minify: do not know how to minify {name}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    p = Path(sys.argv[1])
    sys.stdout.write(minify(p.name, p.read_text()))
