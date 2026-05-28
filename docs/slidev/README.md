# agent bazaar — Slidev deck

Versión web/Markdown del pitch, hecha con [Slidev](https://sli.dev),
con la estética y el brand de la web (electric-blue, Outfit/Manrope/JetBrains Mono,
logomark de nodos, glow y partículas).

## Temas: oscuro (brand) + claro (fallback)

El deck es **bi-tema** desde un solo `slides.md`:

- **Oscuro** — el default, igual que la web.
- **Claro** — fallback de alto contraste por si el proyector lava el oscuro.
  Sin grises flojos: el texto es azul-marino casi negro sobre blanco.

Alterna en vivo con la tecla **`d`**.

## Correr en dev

```bash
cd docs/slidev
npm install
npm run dev          # abre http://localhost:3030  (arranca en oscuro; 'd' alterna)
```

## Build estático (publicable como página)

```bash
npm run build        # genera ./dist
```

## Exportar a PNG / PDF

```bash
npm run export                 # tema actual/oscuro
npm run export:light           # PNG/PDF del tema claro  -> ./shots-light
npm run export:dark            # PNG/PDF del tema oscuro  -> ./shots-dark
# añade --format png para PNG por slide:
npm run export:light -- --format png
```

## Estructura

- `slides.md` — todo el deck en Markdown (un `---` separa cada slide)
- `style.css` — tokens de marca **bi-tema** (`:root` = claro, `html.dark` = oscuro)
- `global-bottom.vue` — fondo de partículas + glow (se adapta al tema)
- `components/LogoMark.vue` — logomark real (recortado de `public/logomark-mark.png`)
- `components/Foot.vue` — pie con "agent bazaar · on Stellar" + número de slide

## Atajos en presentación

- `f` — pantalla completa
- `o` — vista general de slides
- `d` — alternar claro/oscuro
- `←` / `→` — navegar
