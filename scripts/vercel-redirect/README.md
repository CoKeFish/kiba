# Vercel: solo redirects

Kiba ya no se sirve desde Vercel (todo corre en el stack de Coolify del VPS, ver
`docs/DEPLOYMENT.md`). Los proyectos `kiba-landing` y `kiba-dashboard` siguen existiendo
únicamente para que las URLs viejas redirijan (308, conservando la ruta):

- `kiba-landing.vercel.app` → `https://kiba.tools`
- `kiba-dashboard.vercel.app` → `https://app.kiba.tools`

Cada carpeta es el deploy completo de su proyecto (un `vercel.json` con el redirect y un
`index.html` de cortesía). Para volver a desplegarlo:

```bash
cd scripts/vercel-redirect/landing   # o dashboard
VERCEL_ORG_ID=team_9ih8tHa4Rdt6QMgOLYFGnBAx VERCEL_PROJECT_ID=prj_gLOztq0RbVqTKyIaf5skUBkIDtW3 npx vercel deploy --prod --yes
# dashboard: VERCEL_PROJECT_ID=prj_rAW3qHsRmUw9UavD37nRaMZxG2qC
```
