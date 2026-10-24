package com.kholland

import io.ktor.server.application.*
import io.ktor.server.response.*
import io.ktor.server.request.*
import io.ktor.server.routing.*
import com.github.mustachejava.DefaultMustacheFactory
import io.ktor.server.mustache.Mustache
import io.ktor.server.mustache.MustacheContent
import io.ktor.server.http.content.*
import io.ktor.server.sessions.*
import io.ktor.server.plugins.calllogging.*
import io.ktor.server.plugins.compression.*
import io.ktor.server.plugins.defaultheaders.*
import org.slf4j.event.*
import io.ktor.server.websocket.*
import io.ktor.websocket.*
import kotlinx.serialization.Serializable
import com.kholland.race.RoomEnv
import com.kholland.ws.RoomRegistry
import com.kholland.ws.gameSocket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlin.time.Duration.Companion.seconds

fun main(args: Array<String>): Unit = io.ktor.server.netty.EngineMain.main(args)

@Suppress("unused") // Referenced in application.conf
@kotlin.jvm.JvmOverloads
fun Application.module(testing: Boolean = false) = appModule(RoomEnv())

/** Composition root. Tests call this directly to inject short [RoomEnv] timings and a seeded Random. */
fun Application.appModule(
    env: RoomEnv,
    clock: () -> Long = System::currentTimeMillis,
    reconnectGraceMs: Long = 30_000,
) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    monitor.subscribe(ApplicationStopped) { scope.cancel() }
    val registry = RoomRegistry(scope, clock, env, reconnectGraceMs)

    install(Mustache) {
        mustacheFactory = DefaultMustacheFactory("templates/mustache")
    }

    install(Sessions) {
        cookie<MySession>("MY_SESSION") {
            cookie.extensions["SameSite"] = "lax"
        }
    }

    install(Compression) {
        gzip {
            priority = 1.0
        }
        deflate {
            priority = 10.0
            minimumSize(1024) // condition
        }
    }

    install(CallLogging) {
        level = Level.INFO
        filter { call -> call.request.path().startsWith("/") }
    }

    install(DefaultHeaders) {
        header("X-Engine", "Ktor") // will send this header with each response
    }

    // install(HSTS) {
    //     includeSubDomains = true
    // }

    // https://ktor.io/docs/server-https-redirect.html
    // if (!testing) {
    //     install(HttpsRedirect) {
    //         // The port to redirect to. By default 443, the default HTTPS port.
    //         sslPort = 443
    //         // 301 Moved Permanently, or 302 Found redirect.
    //         permanentRedirect = true
    //     }
    // }

    install(WebSockets) {
        pingPeriod = 15.seconds
        timeout = 15.seconds
        maxFrameSize = Long.MAX_VALUE
        masking = false
    }

    routing {
        get("{...}") {
            call.respond(MustacheContent("index.hbs", mapOf("user" to MustacheUser(1, "user man"))))
        }

        // Static plugin. Try to access `/static/ktor_logo.svg`
        staticResources("/static", "static")

        get("/session/increment") {
            val session = call.sessions.get<MySession>() ?: MySession()
            call.sessions.set(session.copy(count = session.count + 1))
            call.respondText("Counter is ${session.count}. Refresh to increment.")
        }

        gameSocket(registry, clock)
    }
}

data class MustacheUser(val id: Int, val name: String)

@Serializable
data class MySession(val count: Int = 0)
