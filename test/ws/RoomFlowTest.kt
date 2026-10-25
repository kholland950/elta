package com.kholland.ws

import com.kholland.appModule
import com.kholland.race.RoomEnv
import com.kholland.race.Timings
import io.ktor.client.plugins.websocket.*
import io.ktor.server.config.*
import io.ktor.server.testing.*
import io.ktor.websocket.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.*
import kotlin.random.Random
import kotlin.test.*

class RoomFlowTest {
    private val timings = Timings(
        exploreLeadMs = 50, exploreMs = 100, goDelayMs = 100,
        finishWindowMs = 60, resultsMs = 300, replayFinishMs = 0, replayTimeoutMs = 0, replaySpeed = 1_000_000, matchOverMs = 5_000, roundTimeoutMs = 120_000,
    )

    private fun ApplicationTestBuilder.boot(reconnectGraceMs: Long = 30_000) {
        environment { config = MapApplicationConfig() }
        application { appModule(RoomEnv(timings, Random(5)), reconnectGraceMs = reconnectGraceMs) }
    }

    private inner class Client(val session: DefaultClientWebSocketSession) {
        suspend fun send(event: String, data: JsonObject = buildJsonObject { }) =
            session.send(Frame.Text(wireJson.encodeToString(Envelope.serializer(), Envelope(event, data))))

        suspend fun next(): Envelope = withTimeout(5_000) {
            val f = session.incoming.receive() as Frame.Text
            wireJson.decodeFromString(Envelope.serializer(), f.readText())
        }

        /** Skips frames until [event] arrives. */
        suspend fun until(event: String): JsonObject {
            while (true) {
                val e = next()
                if (e.event == event) return e.data.jsonObject
            }
        }

        suspend fun expectSilence(ms: Long = 300) {
            val f = withTimeoutOrNullCompat(ms) { session.incoming.receive() }
            assertNull(f, "unexpected frame: ${(f as? Frame.Text)?.readText()}")
        }
    }

    private suspend fun <T> withTimeoutOrNullCompat(ms: Long, block: suspend () -> T): T? =
        kotlinx.coroutines.withTimeoutOrNull(ms) { block() }

    private suspend fun ApplicationTestBuilder.connect(
        room: String, name: String, build: String = "b1", color: String = "Blue", resumeToken: String? = null,
    ): Client {
        val http = createClient { install(WebSockets) }
        val c = Client(http.webSocketSession("/ws/game"))
        c.send("joinRoom", buildJsonObject {
            put("roomId", room); put("name", name); put("color", color); put("build", build)
            if (resumeToken != null) put("resumeToken", resumeToken)
        })
        return c
    }

    private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content
    private fun JsonObject.long(k: String) = getValue(k).jsonPrimitive.long

    @Test
    fun fullRoundFlow() = testApplication {
        boot()
        val a = connect("room1", "alice")
        val joinedA = a.until("joined")
        assertEquals("room1", joinedA.str("roomId"))
        val idA = joinedA.str("playerId")
        val s1 = a.until("roomState")
        assertEquals(idA, s1.str("hostId"))
        assertEquals("lobby", s1.str("phase"))
        assertEquals(3, s1["settings"]!!.jsonObject.long("winsToMatch"))

        val b = connect("room1", "bob", color = "Red")
        val idB = b.until("joined").str("playerId")
        assertEquals(2, b.until("roomState")["players"]!!.jsonArray.size)
        assertEquals(2, a.until("roomState")["players"]!!.jsonArray.size)

        // clock ping
        b.send("clockPing", buildJsonObject { put("t0", 123) })
        val pong = b.until("clockPong")
        assertEquals(123, pong.long("t0"))
        assertTrue(pong.long("serverTime") > 0)

        // non-host cannot start
        b.send("startMatch")
        a.expectSilence(150)

        a.send("startMatch")
        val startA = a.until("roundStart")
        val startB = b.until("roundStart")
        assertEquals(startA, startB)
        assertEquals(1, startA.long("round"))
        assertContains(setOf("tower", "descent", "labyrinth", "speedway", "canyon"), startA["archetype"]!!.jsonPrimitive.content)
        assertEquals(setOf(idA, idB), startA["startOrder"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet())
        val goAt = startA.long("goAt")
        assertEquals(startA.long("exploreAt") + 100, startA.long("snapAt"))
        assertEquals(startA.long("snapAt") + 100, goAt)

        while (System.currentTimeMillis() <= goAt + 20) delay(10)
        a.send("finishReport", buildJsonObject { put("round", 1); put("raceTimeMs", 120.5) })
        b.send("finishReport", buildJsonObject { put("round", 1); put("raceTimeMs", 100.25) })

        val endA = a.until("roundEnd")
        val endB = b.until("roundEnd")
        assertEquals(endA, endB)
        assertEquals(idB, endA.str("winnerId"))
        assertEquals("finish", endA.str("reason"))
        assertEquals(listOf(idB, idA), endA["times"]!!.jsonArray.map { it.jsonObject.str("playerId") })
        assertEquals(1, endA["wins"]!!.jsonObject.long(idB))
        assertNotEquals(JsonNull, endA["nextRoundAt"])
        assertEquals(JsonNull, endA["matchWinnerId"])

        // next round arrives
        assertEquals(2, a.until("roundStart").long("round"))
        a.session.close(); b.session.close()
    }

    @Test
    fun movesAreRelayedWithinTheRoomOnlyAndPlayerIdOverwritten() = testApplication {
        boot()
        val a = connect("roomaaa", "alice")
        val b = connect("roomaaa", "bob")
        val other = connect("roombbb", "carol")
        val idA = a.until("joined").str("playerId")
        b.until("roomState")
        // a sees a roomState for its own join and another for bob's; drain until both are in
        while (a.until("roomState").getValue("players").jsonArray.size < 2) Unit
        other.until("roomState")

        a.send("playerMove", buildJsonObject {
            put("playerId", "spoofed"); put("x", 1.5); put("y", 2.0); put("velocityX", 3.0); put("velocityY", 4.0)
        })
        val move = b.until("playerMove")
        assertEquals(idA, move.str("playerId"))
        assertEquals(1.5, move.getValue("x").jsonPrimitive.double)

        a.send("playerAction", buildJsonObject {
            put("playerId", "spoofed"); put("kind", "dash"); put("x", 1.0); put("y", 2.0); put("dir", "left")
        })
        val action = b.until("playerAction")
        assertEquals(idA, action.str("playerId"))
        assertEquals("dash", action.str("kind"))
        assertEquals("left", action.str("dir"))

        other.expectSilence()
        a.expectSilence(100) // sender gets no echo
        listOf(a, b, other).forEach { it.session.close() }
    }

    @Test
    fun chatReachesEveryoneInTheRoomWithTheSenderStamped() = testApplication {
        boot()
        val a = connect("roomchat", "alice")
        val b = connect("roomchat", "bob")
        val other = connect("roomzzz", "carol")
        val idA = a.until("joined").str("playerId")
        b.until("roomState")
        while (a.until("roomState").getValue("players").jsonArray.size < 2) Unit
        other.until("roomState")

        a.send("chat", buildJsonObject { put("text", "  gl hf  "); put("playerId", "spoofed") })
        for (c in listOf(a, b)) {
            val m = c.until("chatMessage")
            assertEquals(idA, m.str("playerId"))
            assertEquals("gl hf", m.str("text"))
            assertFalse(m.getValue("quick").jsonPrimitive.boolean)
        }

        a.send("quickChat", buildJsonObject { put("id", "ez") })
        val quick = b.until("chatMessage")
        assertEquals("ez", quick.str("text"))
        assertTrue(quick.getValue("quick").jsonPrimitive.boolean)
        a.until("chatMessage")

        a.send("quickChat", buildJsonObject { put("id", "not a line") })
        a.send("chat", buildJsonObject { put("text", "   ") })
        b.expectSilence()
        other.expectSilence()
        listOf(a, b, other).forEach { it.session.close() }
    }

    @Test
    fun chatOverTheLimitMutesTheSenderAndTellsOnlyThem() = testApplication {
        boot()
        val a = connect("roomspam", "alice")
        val b = connect("roomspam", "bob")
        a.until("roomState")
        while (a.until("roomState").getValue("players").jsonArray.size < 2) Unit
        b.until("roomState")
        repeat(8) { a.send("chat", buildJsonObject { put("text", "m$it") }) }
        repeat(5) { assertEquals("m$it", a.until("chatMessage").str("text")) }
        assertEquals(3_000, a.until("chatMuted").long("ms"))
        a.expectSilence() // one notice per mute, and the rest dropped
        repeat(5) { assertEquals("m$it", b.until("chatMessage").str("text")) }
        b.expectSilence()
        listOf(a, b).forEach { it.session.close() }
    }

    @Test
    fun rejections() = testApplication {
        boot()
        val a = connect("roomrej", "alice")
        a.until("roomState")

        val stale = connect("roomrej", "bob", build = "old")
        assertEquals("staleBuild", stale.until("joinRejected").str("reason"))

        val bad = connect("roomrej", "b")
        assertEquals("badName", bad.until("joinRejected").str("reason"))

        a.send("startMatch")
        a.until("roundStart")
        val late = connect("roomrej", "carol")
        assertEquals("inProgress", late.until("joinRejected").str("reason"))
        a.session.close()
    }

    @Test
    fun leaveAnnouncesAndMigratesHost() = testApplication {
        boot()
        val a = connect("roomleave", "alice")
        val idA = a.until("joined").str("playerId")
        val b = connect("roomleave", "bob")
        val idB = b.until("joined").str("playerId")
        b.until("roomState")
        a.session.close()
        assertEquals(idA, b.until("playerLeft").str("playerId"))
        val state = b.until("roomState")
        assertEquals(idB, state.str("hostId"))
        assertEquals(1, state["players"]!!.jsonArray.size)
        b.session.close()
    }

    /** Closes like a dead link: a code that is neither a normal close nor going away. */
    private suspend fun Client.dropLink() = session.close(CloseReason(4000, "link lost"))

    @Test
    fun droppedPlayerKeepsSeatAndResumesMidRound() = testApplication {
        boot()
        val a = connect("roomdrop", "alice")
        val joinedA = a.until("joined")
        val idA = joinedA.str("playerId")
        val token = joinedA.str("resumeToken")
        a.until("roomState")
        val b = connect("roomdrop", "bob", color = "Red")
        b.until("roomState")
        a.until("roomState")
        a.send("startMatch")
        val start = b.until("roundStart")

        a.dropLink()
        b.expectSilence() // no playerLeft: the seat is held

        val a2 = connect("roomdrop", "alice", resumeToken = token)
        val resumed = a2.until("joined")
        assertEquals(idA, resumed.str("playerId"))
        assertEquals(token, resumed.str("resumeToken"))
        assertEquals(2, a2.until("roomState")["players"]!!.jsonArray.size)
        assertEquals(start, a2.until("roundStart"))

        // Moves reach the new connection
        b.send("playerMove", buildJsonObject { put("x", 1.0); put("y", 2.0); put("velocityX", 0); put("velocityY", 0) })
        assertEquals(1.0, a2.until("playerMove").getValue("x").jsonPrimitive.double)
        listOf(a2, b).forEach { it.session.close() }
    }

    @Test
    fun heldSeatIsReleasedWhenGraceRunsOut() = testApplication {
        boot(reconnectGraceMs = 200)
        val a = connect("roomgone", "alice")
        val joinedA = a.until("joined")
        a.until("roomState")
        val b = connect("roomgone", "bob", color = "Red")
        b.until("roomState")

        a.dropLink()
        assertEquals(joinedA.str("playerId"), b.until("playerLeft").str("playerId"))
        assertEquals(1, b.until("roomState")["players"]!!.jsonArray.size)

        val late = connect("roomgone", "alice", resumeToken = joinedA.str("resumeToken"))
        assertEquals("expired", late.until("joinRejected").str("reason"))
        b.session.close()
    }

    @Test
    fun resumeReplacesAConnectionTheServerStillHolds() = testApplication {
        boot()
        val a = connect("roomswap", "alice")
        val joinedA = a.until("joined")
        a.until("roomState")
        val b = connect("roomswap", "bob", color = "Red")
        b.until("roomState")

        val a2 = connect("roomswap", "alice", resumeToken = joinedA.str("resumeToken"))
        assertEquals(joinedA.str("playerId"), a2.until("joined").str("playerId"))
        // The old connection is closed by the server, and its close doesn't take the seat with it
        withTimeout(5_000) { while (a.session.incoming.receiveCatching().isSuccess) Unit }
        b.expectSilence()
        a2.send("playerMove", buildJsonObject { put("x", 3.0); put("y", 0); put("velocityX", 0); put("velocityY", 0) })
        assertEquals(3.0, b.until("playerMove").getValue("x").jsonPrimitive.double)
        listOf(a2, b).forEach { it.session.close() }
    }

    @Test
    fun resumeWithUnknownTokenIsRejected() = testApplication {
        boot()
        val a = connect("roomtok", "alice")
        a.until("roomState")
        val c = connect("roomtok", "carol", resumeToken = "not-a-token")
        assertEquals("expired", c.until("joinRejected").str("reason"))
        a.session.close()
    }

    @Test
    fun returnToLobbyEndsMatchOverWaitEarly() = testApplication {
        boot()
        // alice must join first so she is host; connecting both at once lets bob's join win the race
        val a = connect("roomret", "alice")
        a.until("joined"); a.until("roomState")
        val b = connect("roomret", "bob")
        b.until("joined")
        a.until("roomState") // bob joined
        a.send("updateSettings", buildJsonObject { put("winsToMatch", 1); put("difficulty", 4) })
        a.until("roomState") // settings applied
        a.send("startMatch")
        val start = a.until("roundStart")
        b.until("roundStart")
        val goAt = start.long("goAt")
        while (System.currentTimeMillis() <= goAt + 20) delay(10)
        a.send("finishReport", buildJsonObject { put("round", 1); put("raceTimeMs", 100.0) })
        val end = a.until("roundEnd")
        assertNotEquals(JsonNull, end["matchWinnerId"])
        val first = a.until("lobbyReturn")
        assertEquals(0, first["returned"]!!.jsonArray.size)
        val lobbyAt = first.long("lobbyAt")
        b.until("lobbyReturn")

        a.send("returnToLobby"); a.send("returnToLobby")
        assertEquals(1, a.until("lobbyReturn")["returned"]!!.jsonArray.size)
        b.send("returnToLobby")
        assertEquals(2, a.until("lobbyReturn")["returned"]!!.jsonArray.size)
        // draining to the lobby roomState (earlier roomStates in the buffer are match-phase)
        var state = a.until("roomState")
        while (state.str("phase") != "lobby") state = a.until("roomState")
        assertTrue(System.currentTimeMillis() < lobbyAt)
        assertEquals(0, state["players"]!!.jsonArray.sumOf { it.jsonObject.long("wins") })
        a.session.close(); b.session.close()
    }

    @Test
    fun updateProfileReachesTheOtherPlayer() = testApplication {
        boot()
        val a = connect("roomprof", "alice")
        a.until("joined"); a.until("roomState")
        val b = connect("roomprof", "bob")
        b.until("joined"); b.until("roomState")
        a.until("roomState") // bob joined
        b.send("updateProfile", buildJsonObject { put("name", "SwiftOtter"); put("color", "Mint") })
        val bob = a.until("roomState")["players"]!!.jsonArray.map { it.jsonObject }.single { it.str("name") == "SwiftOtter" }
        assertEquals("Mint", bob.str("color"))
        a.session.close(); b.session.close()
    }
}
