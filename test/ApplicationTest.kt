package com.kholland

import io.ktor.client.request.*
import io.ktor.http.*
import io.ktor.server.config.*
import io.ktor.server.testing.*
import kotlin.test.*

class ApplicationTest {
    @Test
    fun testRoot() = testApplication {
        // Skip application.conf so the module isn't installed twice
        environment { config = MapApplicationConfig() }
        application { module(testing = true) }

        val response = client.get("/")
        assertEquals(HttpStatusCode.OK, response.status)
    }
}
