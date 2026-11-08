# פיילוט 6B לאנדרואיד

האפליקציה נפתחת למשחק עד נקודה אחת מול הבוט. הקוביות מוגרלות במכשיר, ואפשר להתחיל משחק נוסף ממסך התוצאה. מזהה ההתקנה לפיילוט הוא `app.sixb.backgammon.pilot`.

## מבנה התיקייה

- `android/` הוא פרויקט Android שנוצר באמצעות Capacitor.
- `capacitor.config.json` ו־`pnpm-lock.yaml` מגדירים את האפליקציה ותלויותיה.
- `dist/` נוצר בבניית המובייל ומכיל את קבצי המשחק שהאפליקציה אורזת.
- ממשק המשחק משותף לאפליקציה ולאתר ונמצא ב־[frontend](../frontend/README.md). בניית האתר הרגילה יוצרת את הפלט שלה תחת `frontend/dist/`.
- האייקון ומסך הפתיחה משתמשים ב־[לוגו 6B](../frontend/src/assets/6b-logo.png) וב־[אייקון ה־PWA](../frontend/public/pwa-icon-512.png). העותקים לאנדרואיד נמצאים ב־`android/app/src/main/res/drawable-nodpi/`.

## התקנה בטלפון מ־Windows

1. מתקינים Android Studio מגרסה 2025.2.1 ומעלה, וב־SDK Manager מתקינים Android SDK Platform 36, ‏Platform-Tools ו־Build-Tools 35.0.0. משתמשים ב־JDK 21 להרצת Gradle של הפרויקט. [הכנת סביבת הבנייה](https://capacitorjs.com/docs/getting-started/environment-setup)
2. מחברים את הטלפון ב־USB, מפעילים USB debugging ומאשרים בטלפון את בקשת החיבור למחשב. [הרצה על מכשיר Android](https://developer.android.com/studio/run/device)
3. פותחים PowerShell בתיקייה הזו ומגדירים את ה־SDK ואת JDK 21 לחלון הנוכחי. הפקודות משתמשות בנתיבים של ההתקנה במחשב הזה:

   ```powershell
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\6BAndroid\jdk-21"
   pnpm install --frozen-lockfile
   pnpm run android
   ```

הפקודה משתמשת בתלויות שכבר מותקנות ב־`../frontend`. היא בונה את נכסי המשחק, מסנכרנת אותם ל־Android, בונה APK לפיתוח ומתקינה אותו במכשיר. לאחר בנייה מוצלחת, קובץ ה־APK נמצא ב־`android/app/build/outputs/apk/debug/app-debug.apk`.

אם הפקודה לא מוצאת את ה־SDK או את Java, אפשר לבנות דרך Android Studio. קודם מסנכרנים את קבצי המשחק:

```powershell
pnpm run build:assets
pnpm exec cap sync android
pnpm exec cap open android
```

ב־Studio מגדירים JDK 21 בתור Gradle JDK, בוחרים את הטלפון ולוחצים על Run.

## גרסת בדיקה מול השרת הרגיל

**6B Online** היא חבילת Android נפרדת (`app.sixb.backgammon.pilot.preview`). מסך הפתיחה והבוט ארוזים במכשיר. המועדון והלוח המקוון נטענים בתוך האפליקציה משרת 6B דרך HTTPS ו־WSS, עם החשבון הרגיל. ה־WebView של המועדון מופרד מה־WebView של הבוט ועובד בלי גשר Capacitor. החיבור לשרת עובד על Wi-Fi או רשת סלולרית. [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)

מתוך `mobile` מריצים את פקודות הבנייה. הטלפון נדרש רק להתקנה.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\6BAndroid\jdk-21"
pnpm run build:assets
pnpm exec cap sync android
& '.\android\gradlew.bat' -p android :app:assemblePreview
```

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb -d install -r '.\android\app\build\outputs\apk\preview\app-preview.apk'
```

פותחים את **6B Online**, בוחרים „מועדון” ומתחברים עם שם המשתמש והסיסמה הרגילים. בודקים את רשימת הטורנירים ואת „המשחקים שלי”, ואז כניסה ללוח ותחילת משחק. כפתור החזרה של Android חוזר לפי היסטוריית המועדון ויוצא למסך הפתיחה כשאין עמוד קודם. בודקים בנפרד פתיחת משחק מול הבוט במצב טיסה. חיבור דרך Google דורש שילוב התחברות נפרד לאפליקציה. [מדיניות OAuth של Google](https://developers.google.com/identity/protocols/oauth2/policies#secure-browsers)

משחק החבר המקוון משתמש בגרסה שפרוסה בשרת. תיקון הפתיחה שאומת ב־6B Local יגיע גם ל־6B Online לאחר פריסת רכיבי המשחק והמועדון המעודכנים.

## גרסת פיתוח מול המועדון המקומי

**6B Local** מותקנת לצד פיילוט הבוט. מסך הפתיחה הממותג ובחירת „משחק מול הבוט” ארוזים ב־APK וזמינים גם במצב טיסה. כפתור „מועדון” פותח את האתר והלוח בתוך האפליקציה דרך שרת Docker המקומי, עם החשבונות וה־Coins של סביבת הפיתוח. כפתור החזרה של Android חוזר לפי היסטוריית הניווט. תצורת `local` מיועדת לבדיקות דרך USB. [תצורת Capacitor](https://capacitorjs.com/docs/config)

### בניית APK ללא טלפון

מריצים מתוך `mobile`.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\6BAndroid\jdk-21"
pnpm run build:assets
pnpm exec cap sync android
& '.\android\gradlew.bat' -p android :app:assembleLocal
```

### התקנה ובדיקת המועדון

מתוך שורש הפרויקט מפעילים את [סביבת Docker המקומית](../../docker/README.he.md). אם הסביבה משתמשת בתמונות שקדמו לתיקון משחק החבר, בונים את השירותים הבאים לפני שמרימים אותה.

```powershell
docker compose -f docker/compose.local.yaml build game-api tournaments-api game-frontend
.\startDockerBackgammon.ps1 -SkipBuild
```

אחרי חיבור הטלפון, מתקינים מתוך `mobile`.

```powershell
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
& $adb -d reverse tcp:8180 tcp:8180
& $adb -d install -r '.\android\app\build\outputs\apk\local\app-local.apk'
& $adb -d shell am start -n 'app.sixb.backgammon.pilot.local/app.sixb.backgammon.pilot.MainActivity'
```

פותחים את **6B Local** ובודקים את הבוט במצב טיסה ואת החזרה למסך הפתיחה. לאחר חיבור לשרת נכנסים למועדון ומתחברים לחשבון מקומי. פותחים משחק חבר חדש מול חשבון שני בדפדפן במחשב. מוודאים שהצד הראשון ממתין, ששני הלוחות עוברים לזריקת פתיחה לאחר כניסת הצד השני, ושחזרה לאותו משחק אחרי מעבר לרקע שומרת על המצב. אחרי חיבור USB מחדש אפשר להגדיר שוב את העברת פורט 8180. [העברת פורט דרך ADB](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server#set-up-reverse-port-forwarding-with-adb)

### בדיקות ממוקדות למשחק חבר

מתוך `Backgammon Game/frontend` מריצים `pnpm test src/services/tournamentEntryPresence.test.tsx src/services/gameContext.test.tsx`.

עם סביבת PostgreSQL נפרדת לבדיקות ועם Python של כל שירות, מריצים את הפקודות הבאות בתיקייה המתאימה.

- מתוך `Backgammon Game/backend` מריצים `python manage.py test game.link.tests.EnterLinkTests game.tests.test_tournament_entry_confirmation game.tests.test_connection_setup`.
- מתוך `backgammon-tournaments-backend/tournaments` מריצים `python manage.py test gamelink.tests.TicketTest gamelink.tests.DirectPlayLiveSnapshotTest frontend.test_entry_lifecycle`.

## בדיקת קבלה

מפעילים מצב טיסה, פותחים את 6B מהאייקון ובודקים שהלוגו מופיע בפתיחה. משחקים עד מסך התוצאה ולוחצים על „שחק שוב”. בודקים שהלוח והתוצאה מתאפסים ושאפשר לשחק שוב מול הבוט. בדיקה נפרדת היא יציאה באמצע המשחק והתחלת משחק חדש. לאימות בניית האתר, מריצים `pnpm build` מתוך `frontend`.
