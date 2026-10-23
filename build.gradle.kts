import com.github.gradle.node.npm.task.NpmTask

val logbackVersion = providers.gradleProperty("logbackVersion").get()
val ktorVersion = providers.gradleProperty("ktorVersion").get()
val serializationVersion = providers.gradleProperty("serializationVersion").get()

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-host-common:$ktorVersion")
    implementation("io.ktor:ktor-server-mustache:$ktorVersion")
    implementation("io.ktor:ktor-server-sessions:$ktorVersion")
    implementation("io.ktor:ktor-server-websockets:$ktorVersion")
    implementation("io.ktor:ktor-server-compression:$ktorVersion")
    implementation("io.ktor:ktor-server-call-logging:$ktorVersion")
    implementation("io.ktor:ktor-server-default-headers:$ktorVersion")
    implementation("ch.qos.logback:logback-classic:$logbackVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:$serializationVersion")
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-websockets:$ktorVersion")
    testImplementation(kotlin("test"))
}

plugins {
    application
    kotlin("jvm") version "2.4.21"
    kotlin("plugin.serialization") version "2.4.21"
    id("com.gradleup.shadow") version "9.6.1"

    base
    id("com.github.node-gradle.node") version "7.1.0"
}

group = "com.kholland"
version = "0.0.1-SNAPSHOT"

kotlin {
    jvmToolchain(25)
}

application {
    mainClass.set("io.ktor.server.netty.EngineMain")
}

tasks.shadowJar {
    archiveBaseName.set("app")
    archiveClassifier.set("")
    archiveVersion.set("")
}

tasks.test {
    useJUnitPlatform()
}

kotlin.sourceSets["main"].kotlin.srcDirs("src")
kotlin.sourceSets["test"].kotlin.srcDirs("test")

sourceSets["main"].resources.srcDirs("resources", "frontend/dist")
sourceSets["test"].resources.srcDirs("testresources")

defaultTasks("run")

node {
    /* gradle-node-plugin configuration
       https://github.com/node-gradle/gradle-node-plugin/blob/main/docs/usage.md
       Task name pattern:
       ./gradlew npm_<command> Executes an NPM command.
    */
    // If true, it will download node using above parameters.
    // If false, it will try to use globally installed node.
    download.set(true)

    // Version of node to use. Uses the npm bundled with it.
    version.set("24.22.1")
    distBaseUrl.set("https://nodejs.org/dist")

    nodeProjectDir.set(file("frontend/"))
}

tasks.named<NpmTask>("npm_run_build") {
    // Rollup peaks around 1GB bundling Phaser; cap it so it can't starve small machines
    environment.set(mapOf("NODE_OPTIONS" to "--max-old-space-size=1536"))

    // make sure the build task is executed only when appropriate files change
    inputs.files(fileTree("frontend/src"))

    // "node_modules" appeared not reliable for dependency change detection (the task was rerun without changes)
    // though "package.json" and "package-lock.json" should be enough anyway
    inputs.file("frontend/package.json")
    inputs.file("frontend/package-lock.json")

    outputs.dir("frontend/dist")
}

tasks.named("processResources") {
  dependsOn("npm_run_build")
}

tasks.named("classes") {
    dependsOn("npm_run_build")
}

tasks.named("clean") {
    doFirst {
        delete("frontend/dist")
    }
}
