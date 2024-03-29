package com.kholland

import io.ktor.application.*
import io.ktor.response.*
import io.ktor.request.*
import io.ktor.routing.*
import com.github.mustachejava.DefaultMustacheFactory
import io.ktor.mustache.Mustache
import io.ktor.mustache.MustacheContent
import io.ktor.http.content.*
import io.ktor.locations.*
import io.ktor.sessions.*
import io.ktor.features.*
import org.slf4j.event.*
import io.ktor.websocket.*
import io.ktor.http.cio.websocket.*
import kotlinx.coroutines.channels.ClosedReceiveChannelException
import java.time.*

fun main(args: Array<String>): Unit = io.ktor.server.netty.EngineMain.main(args)

@Suppress("unused") // Referenced in application.conf
@kotlin.jvm.JvmOverloads
fun Application.module(testing: Boolean = false) {
    install(Mustache) {
        mustacheFactory = DefaultMustacheFactory("templates/mustache")
    }

    install(Locations) {
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

    // https://ktor.io/servers/features/https-redirect.html#testing
    // if (!testing) {
    //     install(HttpsRedirect) {
    //         // The port to redirect to. By default 443, the default HTTPS port.
    //         sslPort = 443
    //         // 301 Moved Permanently, or 302 Found redirect.
    //         permanentRedirect = true
    //     }
    // }

    install(io.ktor.websocket.WebSockets) {
        pingPeriod = Duration.ofSeconds(15)
        timeout = Duration.ofSeconds(15)
        maxFrameSize = Long.MAX_VALUE
        masking = false
    }

    routing {
        get("{...}") {
            call.respond(MustacheContent("index.hbs", mapOf("user" to MustacheUser(1, "user man"))))
        }

        // Static feature. Try to access `/static/ktor_logo.svg`
        static("/static") {
            resources("static")
        }

        get("/session/increment") {
            val session = call.sessions.get<MySession>() ?: MySession()
            call.sessions.set(session.copy(count = session.count + 1))
            call.respondText("Counter is ${session.count}. Refresh to increment.")
        }

        webSocket("/ws/game") {
            MessageBroker.add(this)

            try {
                while (true) {
                    val frame = incoming.receive()
                    if (frame is Frame.Text) {
                        MessageBroker.receive(frame.readText(), this)
                    }
                }
            } catch (e: ClosedReceiveChannelException) {
                MessageBroker.remove(this)
            }
        }
    }
}

data class MustacheUser(val id: Int, val name: String)

data class MySession(val count: Int = 0)
