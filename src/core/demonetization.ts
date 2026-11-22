import { normalize } from './text';

export type RiskCategory =
  | 'Strong language'
  | 'Violence'
  | 'Adult content'
  | 'Drugs and regulated goods'
  | 'Sensitive events'
  | 'Hateful or derogatory'
  | 'Harmful acts'
  | 'Firearms';

export type RiskLevel = 'high' | 'medium';

interface Term {
  term: string;
  category: RiskCategory;
  level: RiskLevel;
}

function terms(category: RiskCategory, level: RiskLevel, list: string): Term[] {
  return list.split(',').map((t) => ({ term: t.trim(), category, level }));
}

/**
 * An original list written against the topics in YouTube's public advertiser-friendly
 * content guidelines. It flags words worth a second look; it is not YouTube's classifier.
 */
const TERMS: Term[] = [
  ...terms('Strong language', 'high', 'fuck,fucking,fucked,motherfucker,shit,bullshit,bitch,asshole,cunt,dick,pussy,bastard,wtf,stfu'),
  ...terms('Strong language', 'medium', 'damn,hell,crap,ass,piss,pissed,douche,screwed'),
  ...terms('Violence', 'high', 'murder,murdered,killing,killed,massacre,beheading,torture,stabbing,stabbed,shooting,gore,gory,corpse,dead body,execution,bloodbath'),
  ...terms('Violence', 'medium', 'kill,blood,bloody,fight,brutal,assault,attack,death,dies,died,dead,weapon,knife'),
  ...terms('Adult content', 'high', 'porn,porno,pornography,xxx,nsfw,nude,nudes,naked,sex tape,onlyfans,hentai,erotic,fetish,stripper,blowjob,orgasm'),
  ...terms('Adult content', 'medium', 'sex,sexy,sexual,lingerie,bikini,hot girls,seduce,kinky,horny'),
  ...terms('Drugs and regulated goods', 'high', 'cocaine,heroin,meth,methamphetamine,fentanyl,lsd,ecstasy,mdma,crack,overdose,drug dealer,shrooms'),
  ...terms('Drugs and regulated goods', 'medium', 'weed,marijuana,cannabis,thc,vape,vaping,drunk,wasted,high af,stoned,drugs,gambling,casino,betting,cigarette,tobacco'),
  ...terms('Sensitive events', 'high', 'terrorist,terrorism,terror attack,mass shooting,school shooting,genocide,suicide,self harm,war crime,bombing'),
  ...terms('Sensitive events', 'medium', 'war,tragedy,pandemic,earthquake victims,abuse,abused,rape,trafficking,kidnapped,hostage,riot'),
  ...terms('Hateful or derogatory', 'high', 'nazi,white supremacy,racist,retard,retarded,slur'),
  ...terms('Hateful or derogatory', 'medium', 'hate,idiot,stupid,loser,trash,scum'),
  ...terms('Harmful acts', 'high', 'how to hack,hacked account,cheat engine,scam tutorial,eating disorder,anorexia,choking challenge'),
  ...terms('Harmful acts', 'medium', 'dangerous,prank gone wrong,gone wrong,challenge gone wrong,illegal,stolen,steal,hack,exploit,glitch money'),
  ...terms('Firearms', 'high', 'ghost gun,3d printed gun,silencer build,full auto conversion,bump stock'),
  ...terms('Firearms', 'medium', 'gun,guns,rifle,pistol,ammo,ar-15,ak-47,shotgun,firearm'),
];

export type AuditField = 'title' | 'description' | 'tags';

export interface RiskHit {
  term: string;
  category: RiskCategory;
  level: RiskLevel;
  field: AuditField;
  count: number;
}

export interface RiskReport {
  hits: RiskHit[];
  /** green: nothing found; yellow: medium terms, or high terms outside the title; red: high-risk term in the title. */
  rating: 'green' | 'yellow' | 'red';
}

function countTerm(haystack: string, term: string): number {
  const needle = ` ${normalize(term)} `;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length - 1);
  }
  return count;
}

export function auditMonetization(input: { title: string; description: string; tags: string[] }): RiskReport {
  const fields: Record<AuditField, string> = {
    title: ` ${normalize(input.title)} `,
    description: ` ${normalize(input.description)} `,
    tags: ` ${input.tags.map(normalize).join(' | ')} `,
  };
  const hits: RiskHit[] = [];
  for (const field of ['title', 'description', 'tags'] as const) {
    for (const entry of TERMS) {
      const count = countTerm(fields[field], entry.term);
      if (count > 0) hits.push({ ...entry, field, count });
    }
  }
  const red = hits.some((h) => h.level === 'high' && h.field === 'title');
  return { hits, rating: red ? 'red' : hits.length ? 'yellow' : 'green' };
}
