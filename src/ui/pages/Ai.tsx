import { useState } from 'react';
import { complete, parseJsonBlock } from '../../services/ai';
import { setLocalizations } from '../../yt/api';
import { parseVideoId } from '../../yt/innertube';
import { Button, Card, CopyButton, Field, Notice, Page, errorMessage, useToast } from '../kit';
import { useConnection } from '../channel';

type Tab = 'titles' | 'ideas' | 'shorts' | 'translate' | 'thumbnail';

const TABS: { id: Tab; label: string }[] = [
  { id: 'titles', label: 'Titles' },
  { id: 'ideas', label: 'Next videos' },
  { id: 'shorts', label: 'Shorts' },
  { id: 'translate', label: 'Translate' },
  { id: 'thumbnail', label: 'Thumbnail' },
];

export function AiPage() {
  const [tab, setTab] = useState<Tab>('titles');
  const [keyword, setKeyword] = useState('');
  const [context, setContext] = useState('');
  const [language, setLanguage] = useState('es');
  const [video, setVideo] = useState('');
  const [image, setImage] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { connected } = useConnection();

  const ask = async (prompt: string, withImage = false) => {
    setBusy(true);
    setOutput('');
    try {
      setOutput(await complete(prompt, withImage ? image : undefined));
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const saveTranslation = async () => {
    const id = parseVideoId(video) ?? video.trim();
    if (!connected || !id) return toast('Connect the channel and enter the video this translation belongs to.', 'warn');
    try {
      const parsed = parseJsonBlock<{ title: string; description: string }>(output);
      await setLocalizations(id, 'en', { [language]: { title: parsed.title, description: parsed.description } });
      toast(`Saved the ${language} localization.`, 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    }
  };

  return (
    <Page title="AI tools" subtitle="Optional. These call the model and key you set in Settings. Nothing is sent until you press Generate, and nothing is stored except what you then save to YouTube.">
      <div className="row">
        {TABS.map((item) => (
          <Button key={item.id} variant={tab === item.id ? 'primary' : 'ghost'} onClick={() => { setTab(item.id); setOutput(''); }}>{item.label}</Button>
        ))}
      </div>
      <Card>
        {tab === 'titles' ? (
          <>
            <Field label="Keyword"><input value={keyword} onChange={(e) => setKeyword(e.target.value)} /></Field>
            <Field label="What the video is about"><textarea rows={4} value={context} onChange={(e) => setContext(e.target.value)} /></Field>
            <Button variant="primary" busy={busy} onClick={() => void ask(`Write 8 YouTube titles that include the keyword "${keyword}". Each title must be under 70 characters. Return a JSON array of strings and nothing else.\n\n${context}`)}>Generate titles</Button>
          </>
        ) : null}
        {tab === 'ideas' ? (
          <>
            <Field label="Recent video titles" hint="one per line"><textarea rows={6} value={context} onChange={(e) => setContext(e.target.value)} /></Field>
            <Button variant="primary" busy={busy} onClick={() => void ask(`Suggest 8 next videos for a channel whose recent titles are listed below. Return a JSON array of {"title","why"} and nothing else.\n\n${context}`)}>Suggest videos</Button>
          </>
        ) : null}
        {tab === 'shorts' ? (
          <>
            <Field label="Long video description or transcript"><textarea rows={8} value={context} onChange={(e) => setContext(e.target.value)} /></Field>
            <Button variant="primary" busy={busy} onClick={() => void ask(`From the text below, suggest 5 Shorts. Return a JSON array of {"start","end","hook","title"}. Use timestamps only if the text contains them; otherwise describe the moment.\n\n${context}`)}>Suggest Shorts</Button>
          </>
        ) : null}
        {tab === 'translate' ? (
          <>
            <div className="grid c2">
              <Field label="Language code"><input value={language} onChange={(e) => setLanguage(e.target.value)} /></Field>
              <Field label="Video" hint="needed only to save the localization"><input value={video} onChange={(e) => setVideo(e.target.value)} /></Field>
            </div>
            <Field label="Title"><input value={keyword} onChange={(e) => setKeyword(e.target.value)} /></Field>
            <Field label="Description"><textarea rows={5} value={context} onChange={(e) => setContext(e.target.value)} /></Field>
            <div className="row">
              <Button variant="primary" busy={busy} onClick={() => void ask(`Translate this YouTube title and description into language "${language}". Keep the meaning, do not add claims. Return JSON {"title","description","tags"} and nothing else.\n\nTitle: ${keyword}\n\n${context}`)}>Translate</Button>
              <Button disabled={!output} onClick={() => void saveTranslation()}>Save localization</Button>
            </div>
          </>
        ) : null}
        {tab === 'thumbnail' ? (
          <>
            <Field label="Thumbnail">
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => setImage(String(reader.result));
                reader.readAsDataURL(file);
              }} />
            </Field>
            {image ? <img src={image} alt="" style={{ width: 320, borderRadius: 8 }} /> : null}
            <Button variant="primary" busy={busy} disabled={!image} onClick={() => void ask('Critique this YouTube thumbnail for a small mobile feed. Cover contrast, whether the subject reads at a glance, text size, and one concrete change. Eight sentences at most.', true)}>Analyze</Button>
          </>
        ) : null}
      </Card>
      {output ? (
        <Card title="Result" actions={<CopyButton text={output} />}>
          <Result text={output} />
        </Card>
      ) : (
        <Notice>A custom base URL has to be allowed under Settings if it is not one of the built-in providers. The request is sent from this extension, so the key never goes to a CreatorDeck server (there isn't one).</Notice>
      )}
    </Page>
  );
}

function Result({ text }: { text: string }) {
  try {
    const value = parseJsonBlock<unknown>(text);
    return <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>;
  } catch {
    return <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>;
  }
}
