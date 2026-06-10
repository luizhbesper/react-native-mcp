// spec: 040
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLlmsTxt from 'starlight-llms-txt';

export default defineConfig({
  site: 'https://luizhbesper.github.io',
  base: '/react-native-mcp',
  integrations: [
    starlight({
      title: 'react-native-dev-mcp',
      description:
        'MCP server for React Native development — device control, Metro/Hermes runtime bridge, native build diagnostics.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/luizhbesper/react-native-mcp',
        },
      ],
      editLink: {
        baseUrl: 'https://github.com/luizhbesper/react-native-mcp/edit/main/docs/',
      },
      plugins: [starlightLlmsTxt()],
      sidebar: [
        {
          label: 'Getting started',
          items: [
            { slug: 'getting-started/quickstart' },
            { slug: 'getting-started/installation' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { slug: 'guides/agent-loop' },
            { slug: 'guides/build-failures' },
            { slug: 'guides/troubleshooting' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/tools' },
            { slug: 'reference/error-codes' },
            { slug: 'reference/cli' },
          ],
        },
        {
          label: 'For AI agents',
          items: [{ slug: 'ai' }],
        },
        {
          label: 'Contributing',
          items: [{ slug: 'contributing/signatures' }],
        },
      ],
    }),
  ],
});
