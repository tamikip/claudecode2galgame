import React from 'react'
import { Box, Text, useTheme } from 'src/ink.js'

const BANNER_WIDTH = 66
const WELCOME_TITLE = 'Welcome to 辉夜露卡 Terminal'

const GAL_LINES = [
  '  .--------------------------------------------------------------.',
  '  |               Lunar Visual Console : Kaguya Ruka            |',
  '  |--------------------------------------------------------------|',
  '  |      .-"""-.                         _..._                  |',
  "  |    .'  .-.  `.                    .-'_..._`-.               |",
  "  |   /   /   \\   \\      /\\_/\\      .' .'     `. \\              |",
  '  |   |  |  o  |  |     ( o.o )    /  /  sweet  \\ \\             |',
  '  |   \\   \\___/   /      > ^ <    |  |  coding   | |            |',
  "  |    `._     _.`                  \\  \\  mode!  / /             |",
  "  |       `---`                      `.`_____.`./               |",
  '  |                                                              |',
  "  `--------------------------------------------------------------`",
] as const

export function WelcomeV2() {
  const [theme] = useTheme()
  const isLightTheme = ['light', 'light-daltonized', 'light-ansi'].includes(
    theme,
  )

  return (
    <Box width={BANNER_WIDTH}>
      <Box flexDirection="column">
        <Text>
          <Text color={isLightTheme ? 'magenta' : 'cyan'}>{WELCOME_TITLE} </Text>
          <Text dimColor>v{MACRO.VERSION}</Text>
        </Text>
        <Text>
          {'..................................................................'}
        </Text>
        {GAL_LINES.map((line, i) => (
          <Text key={i} color={isLightTheme ? 'magenta' : 'cyan'}>
            {line}
          </Text>
        ))}
        <Text>
          {'..................................................................'}
        </Text>
      </Box>
    </Box>
  )
}
