import { spawn } from 'node:child_process';
import { DomainError } from '../domain/errors.js';

export type OpenFile = (filePath: string) => Promise<void>;

/**
 * `cmd /c start` needs an explicit empty window title, then the file path as a
 * single quoted argument. Embedded quotes are stripped (Windows filenames
 * cannot contain them) so the path can never introduce another argument.
 */
export function windowsStartArguments(filePath: string): string[] {
  return ['/c', 'start', '""', `"${filePath.replaceAll('"', '')}"`];
}

function spawnDetached(
  command: string,
  args: string[],
  windowsVerbatimArguments = false,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * Open a server-resolved file with the OS default handler.
 *
 * Windows uses `cmd /c start` with an explicit empty window title followed by
 * the quoted path. The path is a single argument and never passes through a
 * shell string. Explorer is the fallback. Other platforms are only used for
 * development; the product target is Windows.
 */
export async function openWithDefaultApplication(filePath: string): Promise<void> {
  const attempts: Array<() => Promise<void>> =
    process.platform === 'win32'
      ? [
          () => spawnDetached('cmd.exe', windowsStartArguments(filePath), true),
          () => spawnDetached('explorer.exe', [filePath]),
        ]
      : process.platform === 'darwin'
        ? [() => spawnDetached('open', [filePath])]
        : [() => spawnDetached('xdg-open', [filePath])];

  for (const attempt of attempts) {
    try {
      await attempt();
      return;
    } catch {
      // Try the next handler.
    }
  }

  throw new DomainError(
    'internal_error',
    'Could not open the Attachment with the default application',
  );
}
