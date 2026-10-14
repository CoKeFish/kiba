import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// 9 secciones planas y siempre abiertas (como docs.kiba.tools): cada página se
// ve sin desplegar nada. Las secciones se pintan como encabezados (clase
// `sidebar-section`) y cada ítem lleva un ícono vía `icon-*`.
type Items = SidebarsConfig[string];

const section = (label: string, items: Items) => ({
  type: 'category' as const,
  label,
  collapsible: false,
  className: 'sidebar-section',
  items,
});

const doc = (id: string, icon: string, label?: string) => ({
  type: 'doc' as const,
  id,
  className: `icon-${icon}`,
  ...(label ? {label} : {}),
});

const sidebars: SidebarsConfig = {
  docs: [
    section('Introducción', [
      doc('introduccion/index', 'home', 'Bienvenida'),
      doc('introduccion/estado-del-proyecto', 'activity'),
      doc('introduccion/enlaces', 'link'),
      doc('introduccion/docs-para-asistentes', 'sparkles'),
    ]),
    section('Conceptos', [
      doc('conceptos/servicios-y-registro', 'cube'),
      doc('conceptos/roles', 'users'),
      doc('conceptos/descubrimiento-hibrido', 'search'),
      doc('conceptos/creditos-y-wallet', 'wallet'),
      doc('conceptos/pagos-y-liquidacion', 'coin'),
      doc('conceptos/arquitectura', 'layers'),
      doc('conceptos/modelo-de-confianza', 'shield'),
    ]),
    section('Conecta tu asistente', [
      doc('conecta-tu-asistente/index', 'plug'),
      doc('conecta-tu-asistente/conector-claude', 'chat'),
      doc('conecta-tu-asistente/chatgpt', 'chat'),
      doc('conecta-tu-asistente/instalador-windows', 'download'),
      doc('conecta-tu-asistente/ides-y-clientes-locales', 'terminal'),
      doc('conecta-tu-asistente/herramientas-mcp', 'tool'),
    ]),
    section('Publica un servicio', [
      doc('publica-un-servicio/index', 'upload'),
      doc('publica-un-servicio/quickstart', 'rocket'),
      doc('publica-un-servicio/handler-y-precios', 'coin'),
      doc('publica-un-servicio/despliegue', 'cloud'),
      doc('publica-un-servicio/descubrimiento-y-llamadas', 'search'),
      doc('publica-un-servicio/como-cobras', 'wallet'),
      doc('publica-un-servicio/nombres-y-confianza', 'shield'),
      doc('publica-un-servicio/panel-de-publisher', 'activity'),
      doc('publica-un-servicio/mainnet', 'globe'),
      doc('publica-un-servicio/problemas-frecuentes', 'help'),
    ]),
    section('SDK', [
      doc('sdk/index', 'code'),
      doc('sdk/agent-provider', 'upload'),
      doc('sdk/agent-client', 'download'),
      doc('sdk/operar-tu-plataforma', 'key'),
      doc('sdk/configuracion', 'sliders'),
      doc('sdk/errores', 'help'),
    ]),
    section('API REST del gateway', [
      doc('api/index', 'api'),
      doc('api/autenticacion', 'key'),
      doc('api/endpoints', 'link'),
      doc('api/errores', 'help'),
    ]),
    section('Stellar y on-chain', [
      doc('stellar/index', 'globe'),
      doc('stellar/testnet', 'cloud'),
      doc('stellar/usdc-y-trustlines', 'coin'),
      doc('stellar/contrato-de-registro', 'cube'),
      doc('stellar/trustless-work', 'shield'),
    ]),
    section('Proyecto', [
      doc('recursos/casos-de-uso', 'rocket'),
      doc('recursos/hoja-de-ruta', 'map'),
      doc('recursos/seguridad', 'shield'),
      doc('recursos/self-hosting', 'terminal'),
      doc('recursos/equipo', 'heart'),
    ]),
    section('Soporte', [
      doc('recursos/soporte', 'chat'),
      doc('recursos/faq', 'help'),
      doc('recursos/glosario', 'book'),
    ]),
  ],
};

export default sidebars;
