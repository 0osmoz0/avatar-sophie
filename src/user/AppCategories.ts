/**
 * Catégories d'applications — le Brain ne dépend pas des noms bruts.
 */

export type AppCategory =
  | "coding"
  | "communication"
  | "browser"
  | "media"
  | "gaming"
  | "productivity"
  | "creative"
  | "unknown";

const BUNDLE_CATEGORY: Record<string, AppCategory> = {
  // Coding
  "com.todesktop.230313mzl4w4u92": "coding", // Cursor
  "com.microsoft.VSCode": "coding",
  "com.apple.dt.Xcode": "coding",
  "com.jetbrains.intellij": "coding",
  "com.jetbrains.WebStorm": "coding",
  "com.googlecode.iterm2": "coding",
  "com.apple.Terminal": "coding",
  "dev.warp.Warp-Stable": "coding",
  "com.github.atom": "coding",
  "com.sublimetext.4": "coding",
  "com.panic.Nova": "coding",
  // Communication
  "com.hnc.Discord": "communication",
  "com.discordapp.Discord": "communication",
  "com.tinyspeck.slackmacgap": "communication",
  "com.apple.MobileSMS": "communication",
  "com.apple.mail": "communication",
  "ru.keepcoder.Telegram": "communication",
  "net.whatsapp.WhatsApp": "communication",
  "com.microsoft.teams2": "communication",
  "us.zoom.xos": "communication",
  "com.apple.FaceTime": "communication",
  // Browser
  "com.apple.Safari": "browser",
  "com.google.Chrome": "browser",
  "org.mozilla.firefox": "browser",
  "company.thebrowser.Browser": "browser", // Arc
  "com.brave.Browser": "browser",
  "com.microsoft.edgemac": "browser",
  // Media
  "com.spotify.client": "media",
  "com.apple.Music": "media",
  "com.apple.TV": "media",
  "com.apple.QuickTimePlayerX": "media",
  "com.colliderli.iina": "media",
  "org.videolan.vlc": "media",
  "com.netflix.Netflix": "media",
  // Gaming
  "com.valvesoftware.steam": "gaming",
  "com.epicgames.EpicGamesLauncher": "gaming",
  "com.apple.Chess": "gaming",
  // Productivity
  "com.apple.iWork.Pages": "productivity",
  "com.apple.iWork.Numbers": "productivity",
  "com.apple.iWork.Keynote": "productivity",
  "com.microsoft.Word": "productivity",
  "com.microsoft.Excel": "productivity",
  "com.microsoft.Powerpoint": "productivity",
  "com.apple.Notes": "productivity",
  "com.apple.reminders": "productivity",
  "com.apple.iCal": "productivity",
  "notion.id": "productivity",
  "com.culturedcode.ThingsMac": "productivity",
  // Creative
  "com.adobe.Photoshop": "creative",
  "com.adobe.Illustrator": "creative",
  "com.apple.FinalCut": "creative",
  "com.apple.Motion": "creative",
  "com.bohemiancoding.sketch3": "creative",
  "com.figma.Desktop": "creative",
  "com.pixelmatorteam.pixelmator.x": "creative",
};

const NAME_CATEGORY: Array<[RegExp, AppCategory]> = [
  [/cursor/i, "coding"],
  [/visual studio code|vscode|xcode|intellij|webstorm|terminal|iterm|warp|sublime|nova/i, "coding"],
  [/discord|slack|telegram|whatsapp|messages|mail|zoom|teams|facetime/i, "communication"],
  [/safari|chrome|firefox|arc|brave|edge/i, "browser"],
  [/spotify|music|tv|vlc|iina|netflix|quicktime/i, "media"],
  [/steam|epic games|chess/i, "gaming"],
  [/pages|numbers|keynote|word|excel|powerpoint|notes|notion|things|calendar/i, "productivity"],
  [/photoshop|illustrator|final cut|sketch|figma|pixelmator/i, "creative"],
];

/** Mappe bundleId / nom d'app vers une catégorie stable. */
export function categorizeApp(bundleId: string | null, name: string | null): AppCategory {
  if (bundleId && BUNDLE_CATEGORY[bundleId]) return BUNDLE_CATEGORY[bundleId];
  const hay = `${bundleId ?? ""} ${name ?? ""}`.trim();
  if (!hay) return "unknown";
  for (const [re, cat] of NAME_CATEGORY) {
    if (re.test(hay)) return cat;
  }
  return "unknown";
}

export function isFocusCategory(category: AppCategory): boolean {
  return (
    category === "coding" ||
    category === "productivity" ||
    category === "gaming" ||
    category === "creative"
  );
}
