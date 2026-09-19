# 6B — משחק שש־בש

עודכן: 19.09.2026 לפי הקוד המקומי. הפרויקט מספק את לוח המשחק, השרת הסמכותי ושירות הקוביות; אתר המועדון והניתוח הם פרויקטים נפרדים.

| רכיב | תלויות מוצהרות | תפקיד |
|---|---|---|
| frontend | React 18.2, TypeScript, Vite 8, Tailwind 4, Motion | לוח, WebSocket, מצב מקומי והיסטוריה |
| backend | Django 4.2.7, Channels 4, Daphne, DRF, SimpleJWT | מנוע סמכותי, חדרים, קישור ותורים |
| dice_service | Elixir, Plug/Cowboy | מקור קוביות HTTP למשחק מקוון |

הגרסאות מתארות קובצי תלויות, לא בדיקה של חבילות מותקנות. SQLite היא ברירת מחדל מקומית; ערכי מסד ו־Redis תלויים בהגדרות הסביבה.

## הפעלה

מתוך backend, בסביבת Python נפרדת:

~~~sh
pip install -r requirements.txt
python manage.py migrate
daphne -b 127.0.0.1 -p 8000 backgammon_project.asgi:application
~~~

מתוך dice_service:

~~~sh
mix deps.get
mix run --no-halt
~~~

מתוך frontend:

~~~sh
pnpm install
pnpm dev
~~~

המשחק זמין ב־http://localhost:5173/backgammon/. / ו־/home מפנים ל־VITE_TOURNAMENTS_URL או /tournaments/. בהפעלה של המועדון בפורט נפרד יש להגדיר כתובת מתאימה. שירות הקוביות משתמש כברירת מחדל ב־127.0.0.1:4000. שרת המשחק בוחר Redis כברירת מחדל; CHANNEL_LAYER_BACKEND=memory מתאים לפיתוח חד־תהליכי בלבד.

## מסלולי המשחק

- משחק מקושר: המועדון מנפיק כרטיס, השרת מאמת ויוצר הרשאת משחק, /link מסיר את נתוני הכניסה מה־fragment ומעביר לחדר. כללי המשחק והניצחון נקבעים בשרת.
- משחק מקומי: /backgammon/local?bot=black&target=1 מפעיל מנוע ובוט TypeScript בדפדפן. שמירה, קוביות ושירותים מחוברים אינם מובטחים ללא Backend; זה אינו Open Sage.
- Open Sage: בוט שרת המשתמש בשירות הניתוח. מסך המועדון טוען מחיר והגדרות; חוזה השרת כולל הכנה/חיוב/כניסה. לא בוצעה כאן בדיקת מסלול מלאה. [מצב התרגול](OPEN_SAGE_PRACTICE.he.md).
- תוצאות מקושרות מועברות בתור חזרה למועדון; ניתוחים נשלחים לשירות Open Sage. עובדים נפרדים נדרשים להשלמת העיבוד.

## תחזוקה

[Frontend ונתיבים](frontend/README.md), [Backend וחוזים](backend/README.md), [עיצוב המשחק](frontend/UI_GUIDELINES.md), [קוביות](dice_service/README.md), [PWA](frontend/PWA_DEPLOYMENT.he.md), [משימות רקע](backend/DJANGO_Q.md).

בדיקות מתבצעות בכל רכיב בנפרד: pnpm build / pnpm lint / pnpm test בממשק, python manage.py test בשרת ו־mix test בקוביות. בדיקות מנוע המקבלות קוביות HTTP דורשות שירות או fixture מתאים. הפקודות לא הורצו במסגרת עדכון התיעוד.

לפריסה נדרשים API ו־WebSocket לשרת ASGI, נכסי frontend תחת /backgammon/, שירות קוביות פנימי, Redis ותזמון run_tasks. [נוהל המערכת](../backgammon-tournaments-backend/DEPLOY_GAME_AND_CLUB.he.md), [מצב קיים](../CURRENT_STATE.he.md).
