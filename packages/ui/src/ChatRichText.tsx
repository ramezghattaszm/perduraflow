import { Fragment } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { Anchor, ScrollView, Separator, Text, XStack, YStack } from 'tamagui'
import { H, P } from './typography'

/**
 * ChatRichText — a small, **cross-platform** (web + native) markdown renderer for
 * conversation bubbles. Lexes with `marked` and renders to the design-system `H`/`P`
 * + Tamagui `Text`, so bold / italic / inline-code / links / headings / lists /
 * blockquotes / fenced code / GFM tables all render natively (no `dangerouslySetInnerHTML`,
 * no HTML — safe for LLM output). Ported from EQALL's `ChatRichText`, typed against
 * marked's token types and adapted to this codebase's typography.
 */
export interface ChatRichTextProps {
  content: string
  /** Body text size (matches the surrounding `P`); default 3. */
  size?: 1 | 2 | 3 | 4 | 5
}

const HEADING_LEVEL: Record<number, 'display' | 1 | 2 | 3 | 4> = { 1: 1, 2: 2, 3: 3 }
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
/** Decode entities, turn literal `<br>` into a newline, and strip any other stray tags. */
const clean = (s: string) =>
  decode((s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, ''))

/** Render marked inline tokens (text/strong/em/code/link/br) as Tamagui Text spans. */
function Inline({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.type) {
          case 'strong':
            return (
              <Text key={i} fontWeight="700">
                <Inline tokens={(t as Tokens.Strong).tokens ?? []} />
              </Text>
            )
          case 'em':
            return (
              <Text key={i} fontStyle="italic">
                <Inline tokens={(t as Tokens.Em).tokens ?? []} />
              </Text>
            )
          case 'codespan':
            return (
              <Text key={i} backgroundColor="$surfaceRaised" paddingHorizontal="$1" borderRadius="$2">
                {decode((t as Tokens.Codespan).text)}
              </Text>
            )
          case 'link':
            return (
              <Anchor key={i} href={(t as Tokens.Link).href} target="_blank" color="$primary" textDecorationLine="underline">
                {decode((t as Tokens.Link).text)}
              </Anchor>
            )
          case 'br':
            return <Text key={i}>{'\n'}</Text>
          case 'html': {
            // marked emits raw HTML (e.g. an LLM's `<br>`) as an html token; convert
            // `<br>` to a newline and drop any other tags rather than print them.
            const raw = (t as Tokens.HTML).raw ?? ''
            return <Text key={i}>{clean(raw)}</Text>
          }
          default:
            return <Text key={i}>{clean((t as Tokens.Text).text ?? '')}</Text>
        }
      })}
    </>
  )
}

const COL_W = 150

/**
 * A GFM table — **fixed-width columns** inside a horizontal `ScrollView`, so cells
 * never overlap (text wraps within its column) and a wide table scrolls instead of
 * collapsing. A `gap` between cells keeps columns visually separated.
 */
function Table({ token }: { token: Tokens.Table }) {
  const cols = token.header.length
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <YStack borderWidth={1} borderColor="$borderColor" borderRadius="$4" overflow="hidden" minWidth={cols * (COL_W + 12)}>
        <XStack backgroundColor="$surfaceRaised" paddingHorizontal="$3" paddingVertical="$2" gap="$3">
          {token.header.map((h, i) => (
            <YStack key={i} width={COL_W}>
              <P size={5} weight="b" color="$textPrimary">
                <Inline tokens={h.tokens ?? []} />
              </P>
            </YStack>
          ))}
        </XStack>
        {token.rows.map((row, r) => (
          <Fragment key={r}>
            <Separator />
            <XStack paddingHorizontal="$3" paddingVertical="$2" gap="$3">
              {Array.from({ length: cols }).map((_, c) => (
                <YStack key={c} width={COL_W}>
                  <P size={5} color="$textSecondary">
                    <Inline tokens={row[c]?.tokens ?? []} />
                  </P>
                </YStack>
              ))}
            </XStack>
          </Fragment>
        ))}
      </YStack>
    </ScrollView>
  )
}

/** Render one marked block token. */
function Block({ token, size }: { token: Token; size: 1 | 2 | 3 | 4 | 5 }) {
  switch (token.type) {
    case 'heading': {
      const h = token as Tokens.Heading
      return (
        <H level={HEADING_LEVEL[h.depth] ?? 4}>
          <Inline tokens={h.tokens ?? []} />
        </H>
      )
    }
    case 'paragraph':
      return (
        <P size={size} color="$textPrimary">
          <Inline tokens={(token as Tokens.Paragraph).tokens ?? []} />
        </P>
      )
    case 'list': {
      const l = token as Tokens.List
      return (
        <YStack gap="$1.5">
          {l.items.map((item, i) => (
            <XStack key={i} gap="$2" alignItems="flex-start">
              <P size={size} color="$textSecondary">
                {l.ordered ? `${(typeof l.start === 'number' ? l.start : 1) + i}.` : '•'}
              </P>
              <YStack flex={1} gap="$1.5">
                <Blocks tokens={item.tokens ?? []} size={size} />
              </YStack>
            </XStack>
          ))}
        </YStack>
      )
    }
    case 'table':
      return <Table token={token as Tokens.Table} />
    case 'code':
      return (
        <YStack backgroundColor="$surfaceRaised" padding="$3" borderRadius="$4" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" color="$textPrimary">
            {(token as Tokens.Code).text}
          </Text>
        </YStack>
      )
    case 'blockquote':
      return (
        <XStack paddingLeft="$3" borderLeftWidth={3} borderLeftColor="$borderColor">
          <YStack flex={1} gap="$2">
            <Blocks tokens={(token as Tokens.Blockquote).tokens ?? []} size={size} />
          </YStack>
        </XStack>
      )
    case 'space':
      return null
    case 'text': {
      // A `text` block token (e.g. inside a list item) carries inline tokens
      // (bold/italic/code) — render those, not the raw `**…**` markdown.
      const tx = token as Tokens.Text & { tokens?: Token[] }
      return (
        <P size={size} color="$textPrimary">
          {tx.tokens?.length ? <Inline tokens={tx.tokens} /> : clean(tx.text)}
        </P>
      )
    }
    default: {
      const text = (token as { text?: string }).text
      return text ? (
        <P size={size} color="$textPrimary">
          {clean(text)}
        </P>
      ) : null
    }
  }
}

/** Render a list of block tokens (top-level and inside list items / blockquotes). */
function Blocks({ tokens, size }: { tokens: Token[]; size: 1 | 2 | 3 | 4 | 5 }) {
  return (
    <>
      {tokens.map((t, i) => (
        <Block key={i} token={t} size={size} />
      ))}
    </>
  )
}

/** Markdown → design-system components (web + native). */
export function ChatRichText({ content, size = 3 }: ChatRichTextProps) {
  const tokens = marked.lexer(content) as Token[]
  return (
    <YStack gap="$2">
      <Blocks tokens={tokens} size={size} />
    </YStack>
  )
}
