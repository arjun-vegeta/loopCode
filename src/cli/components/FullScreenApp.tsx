import React, { useState, useEffect, PropsWithChildren } from 'react';
import { Box } from 'ink';

interface FullScreenAppProps {
  onScrollUp?: () => void;
  onScrollDown?: () => void;
}

export function FullScreenApp({ children, onScrollUp, onScrollDown }: PropsWithChildren<FullScreenAppProps>) {
  const [size, setSize] = useState({
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  });

  useEffect(() => {
    // Enter alternate screen buffer, enable mouse tracking & bracketed paste
    process.stdout.write('\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?2004h');

    const handleResize = () => {
      setSize({
        rows: process.stdout.rows || 24,
        columns: process.stdout.columns || 80,
      });
    };
    process.stdout.on('resize', handleResize);

    const restore = () => {
      process.stdout.write('\x1b[?2004l\x1b[?1006l\x1b[?1000l\x1b[?1049l');
    };

    process.on('exit', restore);

    return () => {
      restore();
      process.stdout.off('resize', handleResize);
      process.off('exit', restore);
    };
  }, []);

  // Capture mouse scroll events directly from stdin
  useEffect(() => {
    const handleData = (data: Buffer) => {
      const str = data.toString();
      // eslint-disable-next-line no-control-regex
      const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (match) {
        const button = parseInt(match[1], 10);
        if (button === 64 && onScrollUp) {
          onScrollUp();
        } else if (button === 65 && onScrollDown) {
          onScrollDown();
        }
      }
    };

    process.stdin.on('data', handleData);
    return () => {
      process.stdin.off('data', handleData);
    };
  }, [onScrollUp, onScrollDown]);

  return (
    <Box flexDirection="column" height={size.rows} width={size.columns} overflow="hidden">
      {children}
    </Box>
  );
}
