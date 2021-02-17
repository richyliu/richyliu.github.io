# Personal website

Uses the static site generator [Zola](https://www.getzola.org).

## Development

To build locally, run:

```
zola build -o docs
```

To serve images properly (workaround for zola mime-type bug):

```
zola build -u 'http://127.0.0.1:8000/'
cd public/
python3 -m http.server
```
