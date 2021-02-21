# ktor/phaser game poc

## Run
Backend
CLI:
```
./gradlew
```
IntelliJ:
Run `Application.kt`


Frontend
```
cd frontend
npm install
npm run dev
```


Client Routing

```
/
  -> Create/join room
  -> Create room asks server for room code, sends to /joinroom/{id}
  -> Join room prompts for room code, sends to /joinroom/{id}

/joinroom/{id}
  -> link to /joinroom/{id}, pick name/color
  -> save/load values to/from localStorage
  -> Sends to /room/{id}

/room/{id}
  -> load name/color from localStorage
  -> render game
```

## Dependencies
Backend: Kotlin, Ktor

Frontend: Typescipt, Phaser 3
