import MDXComponents from '@theme-original/MDXComponents';
import TW from '@site/src/components/TW';
import {Cards, Card} from '@site/src/components/Cards';

// Componentes disponibles en cualquier .md/.mdx sin importarlos.
export default {
  ...MDXComponents,
  TW,
  Cards,
  Card,
};
