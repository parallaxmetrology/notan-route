# Contributing

Most useful contributions come from people who look at pictures for a living.

- **Routes and fields that look wrong.** A painting where the masses the tool groups into one basin do not belong together in your eye, or where the field misses a link the picture plainly makes. Say what you see and what the tool says (`notan-route draw IMAGE -o out.png`).
- **New known-answer scenes.** A synthetic image whose right route or right basins are not in doubt, and which the current route gets wrong, belongs in `scenes.py`.
- **Changes to the Notan mass itself** belong in [parallaxmetrology/notan](https://github.com/parallaxmetrology/notan).

## Development

```bash
git clone https://github.com/parallaxmetrology/notan-route
cd notan-route
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
ruff check .
pytest
```

`tests/test_gates.py` holds predictions that were written before the code was trusted. Change a gate only with a reason in the changelog. `python tools/make_readme_images.py` rebuilds the figures and `python tools/stability.py` the stability table.

Be kind and specific. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
