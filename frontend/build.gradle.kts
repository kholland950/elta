import com.moowork.gradle.node.NodeExtension
import com.moowork.gradle.node.npm.NpmTask

buildscript {
    repositories {
        mavenCentral()
        maven(url = "https://plugins.gradle.org/m2/")
    }

    dependencies {
        classpath("com.moowork.gradle:gradle-node-plugin:1.2.0")
    }
}

plugins {
    base
    id("com.moowork.node") version "1.2.0" // gradle-node-plugin
}

node {
    /* gradle-node-plugin configuration
       https://github.com/srs/gradle-node-plugin/blob/master/docs/node.md
       Task name pattern:
       ./gradlew npm_<command> Executes an NPM command.
    */

    // Version of node to use.
    version = "15.2.0"

    // Version of npm to use.
    npmVersion = "7.0.8"

    // If true, it will download node using above parameters.
    // If false, it will try to use globally installed node.
    download = true
}

tasks.named<NpmTask>("npm_run_build") {
    // make sure the build task is executed only when appropriate files change
    inputs.files(fileTree("public"))
    inputs.files(fileTree("src"))

    // "node_modules" appeared not reliable for dependency change detection (the task was rerun without changes)
    // though "package.json" and "package-lock.json" should be enough anyway
    inputs.file("package.json")
    inputs.file("package-lock.json")

    outputs.dir("build")
}

// pack output of the build into JAR file
val packageFrontend by tasks.registering(Jar::class) {
    dependsOn("npm_run_build")
    archiveBaseName.set("frontend")
    archiveExtension.set("jar")
    destinationDirectory.set(file("${projectDir}/build_packageFrontend"))
    from("build") {
        // optional path under which output will be visible in Java classpath, e.g. static resources path
        into("static")
    }
}

// declare a dedicated scope for publishing the packaged JAR
val npmResources by configurations.creating

configurations.named("default").get().extendsFrom(npmResources)

// expose the artifact created by the packaging task
artifacts {
    add(npmResources.name, packageFrontend.get().archivePath) {
        builtBy(packageFrontend)
        type = "jar"
    }
}

tasks.assemble {
    dependsOn(packageFrontend)
}

val testsExecutedMarkerName: String = "${projectDir}/.tests.executed"

val test by tasks.registering(NpmTask::class) {
    dependsOn("assemble")

    // force Jest test runner to execute tests once and finish the process instead of starting watch mode
    setEnvironment(mapOf("CI" to "true"))

    setArgs(listOf("run", "test"))

    inputs.files(fileTree("src"))
    inputs.file("package.json")
    inputs.file("package-lock.json")

    // allows easy triggering re-tests
    doLast {
        File(testsExecutedMarkerName).appendText("delete this file to force re-execution JavaScript tests")
    }
    outputs.file(testsExecutedMarkerName)
}

tasks.check {
    dependsOn(test)
}

tasks.clean {
    delete(packageFrontend.get().archivePath)
    delete(testsExecutedMarkerName)
}
