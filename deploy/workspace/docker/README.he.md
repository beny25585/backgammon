# סביבת Docker מקומית

סביבה נפרדת בשם `backgammon-local`. היא כוללת PostgreSQL 16, Redis, שלושה
שרתי API, עובדי המשחק/טורנירים/Push/ניתוח, שירות הקוביות, שלושת האתרים ו־Nginx.
שרתי Python משתמשים ב־Daphne או Gunicorn, ולא ב־`runserver`.

## הפעלה ב־Windows

פתח Docker Desktop עם Linux containers. מתוך תיקיית הפרויקט:

```powershell
.\startDockerBackgammon.bat
```

אפשר גם להפעיל דרך הקובץ הקיים:

```powershell
.\startServersBackgamon.bat -Docker
```

ההפעלה הראשונה בונה תמונות Docker, כולל Open Sage בגרסת המקור המקובעת
ובבנייה שתואמת גם מעבדים ללא AVX2. היא יכולה לקחת כמה דקות.
האתרים המקומיים רצים עם Vite; פקודות הבנייה לפרודקשן ובדיקות היישום אינן
חלק מההפעלה. תצורת `pnpm-workspace.yaml` וה־lockfiles נשמרות בזמן התקנת התלויות.

לאחר שהתמונות כבר נבנו:
הקוד מועתק לתמונות בזמן הבנייה. לאחר שינוי קוד יש להפעיל שוב את הפקודה
הרגילה כדי לבנות את התמונות המעודכנות. `-SkipBuild` מתאים להפעלה ללא שינוי קוד:

```powershell
.\startDockerBackgammon.ps1 -SkipBuild
```

כתובות:

| רכיב | כתובת |
| --- | --- |
| אתר השחקנים | http://backgammon.localhost:8180/tournaments/ |
| המשחק | http://backgammon.localhost:8180/backgammon/ |
| ממשק המנהלים | http://backgammon.localhost:8180/tournaments-admin/ |
| Django admin | http://backgammon.localhost:8180/admin/ |

Chrome ו־Edge מזהים שמות שמסתיימים ב־`.localhost` ככתובות מקומיות.
בתוך רשת Docker אותו שם מצביע על Nginx. כך הקישורים לדפדפן והקריאות בין
השירותים משתמשים באותה כתובת, בלי להפנות בקשות ל־localhost של הקונטיינר.
הפורט היחיד שמפורסם למחשב הוא `127.0.0.1:8180`; המסד, Redis, הניתוח והקוביות
נגישים ברשת Docker בלבד. הסביבה הקיימת וקונטיינרי `db_dom` יכולים להמשיך לרוץ.

## נתונים וחשבונות

הסביבה מתחילה עם מסדים חדשים. היא אינה מייבאת את מסדי SQLite, את PostgreSQL
המקומי בפורט 55432, או את נתוני השרת. למחשב בלבד אושר להתחיל ללא נתונים ישנים.

באותו שרת PostgreSQL נוצרים שלושה מסדים ושלושה משתמשי יישום נפרדים:
`backgammon_game`, `backgammon_tournaments`, `backgammon_analysis`.
משתמשי היישום אינם superusers ואינם רשאים ליצור משתמשים או מסדים נוספים.
כל API ועובד הרקע שלו מקבלים את אותו מסד ואת אותם סודות.

המיגרציות רצות בשירותים חד־פעמיים לפני הפעלת ה־API. כשל במיגרציה מונע הפעלת
ה־API התלוי בה. הנתונים והמדיה נשמרים ב־named volumes; החלפת תמונה או עצירת
קונטיינרים אינה מוחקת אותם. אל תפעיל `down -v` או `docker volume prune`
על סביבת הפרויקט כשאתה צריך לשמור את הנתונים.

צור משתמש מנהל מקומי חדש בתוך מסד הטורנירים:

```powershell
docker compose -f docker/compose.local.yaml run --rm --no-deps tournaments-api python manage.py createsuperuser
```

אותו משתמש משמש באתר הטורנירים ובממשק המנהלים. כניסה למשחק מקושר נעשית דרך
הטורנירים; אין צורך להעתיק את משתמש הטורנירים למסד המשחק.

פקודות הניהול משתמשות ב־`run --rm --no-deps` כדי לטעון את סודות השירות דרך
נקודת הכניסה של התמונה. `exec ... python manage.py` לבדו אינו טוען אותם.

הסודות נוצרים פעם אחת תחת `docker/.local/` ומועברים כ־Compose secrets.
התיקייה מוחרגת מ־Git ומה־build context. ההפעלה הבאה שומרת את אותם סודות.
אם חלק מהקבצים חסרים, ההכנה נעצרת ולא מחליפה סיסמאות של מסד קיים.
אין להעתיק תיקייה זו לצ'אט, ל־Git או לתמונת Docker.

## מצב, לוגים ועצירה

```powershell
.\startDockerBackgammon.ps1 -Action status
.\startDockerBackgammon.ps1 -Action logs
.\startDockerBackgammon.ps1 -Action stop
```

`Ctrl+C` בזמן צפייה בלוגים מסיים רק את הצפייה. `stop` עוצר את כל שירותי
הפרויקט ושומר את הנתונים. ההפעלה החוזרת משתמשת במסדים ובסודות הקיימים.
הלוגים מוגבלים בגודל ומסתובבים כדי שלא ימלאו את דיסק המחשב.

בדיקות חיבור ומיגרציות, ללא הרצת tests:

```powershell
docker compose -f docker/compose.local.yaml run --rm --no-deps game-api python manage.py migrate --check
docker compose -f docker/compose.local.yaml run --rm --no-deps tournaments-api python manage.py migrate --check
docker compose -f docker/compose.local.yaml run --rm --no-deps analysis-api python manage.py migrate --check
```

כדי לוודא חיבור למסד של כל שירות, החלף `game-api` בשם השירות הרצוי:

```powershell
docker compose -f docker/compose.local.yaml run --rm --no-deps game-api python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print(connection.vendor, connection.settings_dict['NAME'])"
```

בדיקות ה־health אינן בדיקת משחק בין שני שחקנים ואינן בדיקת עומס. בדיקות
היישום, בניית האתרים ובדיקת מובייל נשארות לפי חלוקת העבודה עם המשתמש.
בדיקות PostgreSQL שיוצרות מסד בדיקה דורשות משתמש בדיקות נפרד עם CREATEDB;
אין להוסיף הרשאה זו למשתמשי היישום הרגילים.

## ההבדל מפרודקשן והמעבר לשרת

זו סביבת HTTP מקומית עם DEBUG מופעל לצורך פיתוח. בפרודקשן יש להגדיר דומיין
ו־HTTPS, לכבות DEBUG, להפעיל את בדיקות הפריסה, ולבנות את שלושת האתרים
לנכסים סטטיים. ה־Dockerfile של האתרים כולל יעד `production`, אך Compose
המקומי בוחר `development`. אין לפרוס את `compose.local.yaml` כפי שהוא לשרת.

Google login כבוי עד להגדרת client וכתובת מורשית המתאימה למקור החדש.
דואר נכתב ללוג המקומי; תשלומים כבויים. עובד Push מקבל מפתחות מקומיים חדשים,
אך קבלת הודעה בטלפון אמיתי לא מאומתת באמצעות הפעלת הקונטיינר.

לפני מעבר השרת: יש למפות את השירותים והסביבה הפעילים, לגבות את שלושת המסדים
והמדיה, לשחזר בסביבה נפרדת, ולהכין תוכנית חזרה. נתוני השרת אינם נתונים
חד־פעמיים ואסור להתחיל שם עם מסדים ריקים. גיבויים של מסדים נפרדים אינם
עסקה אחת בין כל השירותים; העברה עקבית מחייבת עצירת כתיבות בזמן המעבר.
רק לאחר ההעברה יש לבטל את ה־systemd/cron הישנים, כדי שלא יהיו עובדים כפולים.
לתורי תחזוקה חיצוניים כגון `purge_expired` ו־`reconcile_tranzila` יש לשמר
את התזמון הקיים במסגרת תצורת הפרודקשן; אין להחליפם בתהליך חדש בפיתוח.

להכנה נפרדת לשרת, ראה [הוראות הפרודקשן](PRODUCTION.he.md).
