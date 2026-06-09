import { parseArgs } from 'node:util';

export interface Config {
  projectRoot: string;
  metroPort: number;
  eagerMetro: boolean;
  verbose: boolean;
  headless: boolean;
}

export interface ParsedCli {
  config: Config;
  showHelp: boolean;
  showVersion: boolean;
}

export const HELP_TEXT = `react-native-dev-mcp — MCP server for React Native development

Usage: react-native-dev-mcp [options]

Options:
  --project-root <path>  React Native project root (default: cwd)
  --metro-port <port>    Metro dev server port (default: 8081)
  --eager-metro          Connect to the Metro inspector at startup so console
                         logs buffer immediately (default: lazy, on first use)
  --verbose              Log diagnostics to stderr
  --help                 Show this help
  --version              Show version

Environment:
  RN_MCP_HEADLESS=1      Don't open simulator windows (CI mode)
`;

export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): ParsedCli {
  const { values } = parseArgs({
    args: argv,
    options: {
      'project-root': { type: 'string' },
      'metro-port': { type: 'string' },
      'eager-metro': { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
    },
    strict: true,
  });

  const port = values['metro-port'] ? Number.parseInt(values['metro-port'], 10) : 8081;
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --metro-port: ${values['metro-port']}`);
  }

  return {
    config: {
      projectRoot: values['project-root'] ?? process.cwd(),
      metroPort: port,
      eagerMetro: values['eager-metro'] ?? false,
      verbose: values.verbose ?? false,
      headless: env.RN_MCP_HEADLESS === '1' || env.CI === 'true',
    },
    showHelp: values.help ?? false,
    showVersion: values.version ?? false,
  };
}
