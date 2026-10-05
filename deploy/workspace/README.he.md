# פריסה דרך Git

התיקייה הזאת היא המקור ב־Git לקובצי Docker, הניטור, כלי ההעברה וסקריפטי
ההפעלה המשותפים. ארבעת מאגרי היישומים נשארים נפרדים. `release.json`
מקבע את ה־commit של כל אחד מהם ואת תג התמונות של הגרסה.

## הכנה בשרת

Docker כבר הותקן ב־Bot1. הכנת הקוד והבנייה אינן מחליפות את השירותים הפעילים.
יש להריץ את הפקודות כ־administrator, ללא sudo עבור Git או הכנת תיקיות הקוד.
הסקריפט משתמש רק ב־Python הסטנדרטי וב־Git.

שכפל את מאגר המשחק לתיקיית bootstrap חדשה, ועבור ל־commit של התשתית
שפורסם. הפקודות לדוגמה משתמשות ב־master; לפריסה בפועל יש לבחור את ה־commit
המדויק שסוקר ולבצע `git checkout --detach COMMIT` לפני ההכנה.

```bash
git clone https://github.com/beny25585/backgammon.git "$HOME/backgammon-bootstrap-20261005-git-r1"
cd "$HOME/backgammon-bootstrap-20261005-git-r1"
python3 deploy/workspace/prepare_workspace.py \
  --destination "$HOME/backgammon-deploy/bg-20261005-git-r1"
```

תיקיית היעד חייבת להיות חדשה. הסקריפט משכפל אליה את ארבעת המאגרים לפי
הגרסאות המקובעות ומייצא אליה את תשתית הפריסה מתוך ה־commit של bootstrap.
הוא יוצר `docker/production.env` עם תג התמונות ופורטי הבדיקה 18005–18007.
הקובץ אינו מכיל סודות. נתוני מסדים, מדיה, סודות וקבצי הגדרות מהמחשב המקומי
אינם מועתקים. כשל משאיר את תיקיית ההכנה לבדיקה ואינו מוחק אותה.

```text
bg-20261005-git-r1/
├── .dockerignore
├── .workspace-release.json
├── docker/
├── Backgammon Game/
├── backgammon-analysis-service/
├── backgammon-tournaments/
├── backgammon-tournaments-backend/
├── operations/
└── startDockerBackgammon.ps1
```

## בנייה על השרת — מריץ המשתמש

```bash
cd "$HOME/backgammon-deploy/bg-20261005-git-r1"
bash docker/build_on_server.sh
```

לפני הבנייה נבדקים ה־commits, ניקיון מאגרי המקור, hashes של קובצי התשתית
ותג התמונות. `production.env` ניתן לעריכה לצורך דומיין, נתיבי סודות ופורטים;
תג הגרסה נשאר תואם ל־manifest.

Buildx משתמש ב־builder ייעודי עם מגבלת ליבת CPU אחת ו־3 GiB RAM, ללא swap,
ובתור בנייה פנימי עם פעולה אחת בכל פעם. שבע התמונות נבנות אחת אחרי השנייה
ונטענות ל־Docker המקומי. ה־builder נעצר בסיום או בכשל; התמונות וה־cache נשמרים.
לא מופעלים שרתי יישום, workers, מיגרציות או העברת נתונים. הבנייה עדיין צורכת
משאבי שרת ויכולה לקחת זמן כאשר המערכת הפעילה ממשיכה לשרת משתמשים.

## המשך המעבר

אחרי הצלחת הבנייה ממשיכים שלב אחר שלב לפי [מדריך הפרודקשן](docker/PRODUCTION.he.md):
לכידת ההגדרות האפקטיביות תחת `/etc/backgammon-docker`, גיבוי, תרגול העברה
על עותק נתוני השרת, אימות היישומים, ורק לאחר מכן חלון תחזוקה והחלפה.
נתוני המשחק והטורנירים נשמרים; מסד הניתוח מתחיל חדש כפי שאושר.

Nginx, Certbot, Grafana, Loki ו־Alloy הקיימים נשארים בשרת. התאמות האיסוף
נמצאות ב־[MONITORING.he.md](docker/MONITORING.he.md) וב־[METRICS.he.md](docker/METRICS.he.md).
השהיית משימות הטורנירים נשמרת עד אישור נפרד לחידושן.

לפריסה חדשה מעדכנים את `release.json`, בוחרים תג תמונות חדש, מפרסמים commit
ומכינים תיקיית יעד חדשה. אין להריץ reset או checkout במאגרים של השירותים הפעילים.
סקריפטי Windows והכלים תחת `operations` זמינים אחרי ההכנה; בדיקות ובנייה
נשארות על המשתמש, ו־venvs או Redis חיצוני אינם חלק מ־Git.
