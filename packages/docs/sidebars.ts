import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

// Estructura de kiba-documentacion-oficial.md (Parte A, §1–§14).
// Las categorías de primer nivel se pintan como encabezados de sección
// (clase `sidebar-section`); los ítems llevan un ícono vía `icon-*`.
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

// Categoría desplegable con página índice propia.
const group = (label: string, icon: string, index: string, items: string[]) => ({
  type: 'category' as const,
  label,
  className: `icon-${icon}`,
  collapsed: true,
  link: {type: 'doc' as const, id: index},
  items,
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
    section('Guías', [
      group('Conecta tu asistente', 'plug', 'conecta-tu-asistente/index', [
        'conecta-tu-asistente/conector-claude',
        'conecta-tu-asistente/chatgpt',
        'conecta-tu-asistente/ides-y-clientes-locales',
        'conecta-tu-asistente/herramientas-mcp',
      ]),
      group('Publica un servicio', 'upload', 'publica-un-servicio/index', [
        'publica-un-servicio/quickstart',
        'publica-un-servicio/handler-y-precios',
        'publica-un-servicio/despliegue',
        'publica-un-servicio/descubrimiento-y-llamadas',
        'publica-un-servicio/como-cobras',
        'publica-un-servicio/nombres-y-confianza',
        'publica-un-servicio/panel-de-publisher',
        'publica-un-servicio/mainnet',
        'publica-un-servicio/problemas-frecuentes',
      ]),
    ]),
    section('Referencia', [
      group('SDK (kiba-sdk)', 'code', 'sdk/index', [
        'sdk/agent-provider',
        'sdk/agent-client',
        'sdk/operar-tu-plataforma',
        'sdk/configuracion',
        'sdk/errores',
      ]),
      group('API REST del gateway', 'api', 'api/index', [
        'api/autenticacion',
        'api/endpoints',
        'api/errores',
      ]),
      group('Stellar y on-chain', 'globe', 'stellar/index', [
        'stellar/testnet',
        'stellar/usdc-y-trustlines',
        'stellar/contrato-de-registro',
        'stellar/trustless-work',
      ]),
    ]),
    section('Recursos', [
      doc('recursos/seguridad', 'key'),
      doc('recursos/casos-de-uso', 'rocket'),
      doc('recursos/hoja-de-ruta', 'map'),
      doc('recursos/self-hosting', 'terminal'),
      doc('recursos/equipo', 'heart'),
      doc('recursos/soporte', 'chat'),
      doc('recursos/faq', 'help'),
      doc('recursos/glosario', 'book'),
    ]),
  ],
};

export default sidebars;
