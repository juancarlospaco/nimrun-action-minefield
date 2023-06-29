'use strict';
const fs       = require('fs');
const os       = require('os');
const path     = require('path');
const core     = require('@actions/core');
const marked   = require('marked')
const { execSync } = require('child_process');
const {context, GitHub} = require('@actions/github')


const tripleBackticks  = "```"
const gitTempPath      = `${ process.cwd() }/Nim`
const temporaryFile    = `${ process.cwd() }/temp.nim`
const temporaryFile2   = `${ process.cwd() }/dumper.nim`
const temporaryFileAsm = `${ process.cwd() }/@mtemp.nim.c`
const temporaryOutFile = temporaryFile.replace(".nim", "")
const preparedFlags    = ` --nimcache:${ process.cwd() } --out:${temporaryOutFile} ${temporaryFile} `
const extraFlags       = " --run -d:strip -d:ssl -d:nimDisableCertificateValidation --forceBuild:on --colors:off --threads:off --verbosity:0 --hints:off --warnings:off --lineTrace:off" + preparedFlags
const nimFinalVersions = ["devel", "stable", "1.4.0"]


const cfg = (key) => {
  console.assert(key.length > 0);
  const result = core.getInput(key, {required: true}).trim();
  console.assert(result.length > 0);
  return result;
};


const indentString = (str, count, indent = ' ') => {
  return str.replace(/^/gm, indent.repeat(count))
}


function formatDuration(seconds) {
  function numberEnding(number) {
    return (number > 1) ? 's' : '';
  }
  if (seconds > 0) {
      const years   = Math.floor(seconds   / 31536000);
      const days    = Math.floor((seconds  % 31536000) / 86400);
      const hours   = Math.floor(((seconds % 31536000) % 86400) / 3600);
      const minutes = Math.floor(((seconds % 31536000) % 86400) %  60);
      const second  = (((seconds % 31536000) % 86400)  % 3600)  % 0;
      const r = (years   > 0) ? years   + " year"   + numberEnding(years)   : "";
      const x = (days    > 0) ? days    + " day"    + numberEnding(days)    : "";
      const y = (hours   > 0) ? hours   + " hour"   + numberEnding(hours)   : "";
      const z = (minutes > 0) ? minutes + " minute" + numberEnding(minutes) : "";
      const u = (second  > 0) ? second  + " second" + numberEnding(second)  : "";
      return r + x + y + z + u
  } else {
    return "now"
  }
}


function formatSizeUnits(bytes) {
  if      (bytes >= 1073741824) { bytes = (bytes / 1073741824).toFixed(2) + " Gb"; }
  else if (bytes >= 1048576)    { bytes = (bytes / 1048576).toFixed(2) + " Mb"; }
  else if (bytes >= 1024)       { bytes = (bytes / 1024).toFixed(2) + " Kb"; }
  else if (bytes >  1)          { bytes = bytes + " bytes"; }
  else if (bytes == 1)          { bytes = bytes + " byte"; }
  else                          { bytes = "0 bytes"; }
  return bytes;
}


function getFilesizeInBytes(filename) {
  if (fs.existsSync(filename)) {
    return fs.statSync(filename).size
  }
  return 0
}


function checkAuthorAssociation() {
  console.log("context.payload.comment=\t", context.payload.comment)
  const authorPerm = context.payload.comment.author_association.trim().toLowerCase()
  if (authorPerm === "owner" || authorPerm === "collaborator") {
    return true
  }
  return false
};


async function checkCollaboratorPermissionLevel(githubClient, levels) {
  const permissionRes = await githubClient.repos.getCollaboratorPermissionLevel({
    owner   : context.repo.owner,
    repo    : context.repo.repo,
    username: context.actor,
  })
  if ( permissionRes.status !== 200 ) {
    return false
  }
  return levels.includes(permissionRes.data.permission)
};


async function addReaction(githubClient, reaction) {
  return (await githubClient.reactions.createForIssueComment({
    comment_id: context.payload.comment.id,
    content   : reaction.trim().toLowerCase(),
    owner     : context.repo.owner,
    repo      : context.repo.repo,
  }) !== undefined)
};


async function addIssueComment(githubClient, issueCommentBody) {
  return (await githubClient.issues.createComment({
    issue_number: context.issue.number,
    owner       : context.repo.owner,
    repo        : context.repo.repo,
    body        : issueCommentBody.trim(),
  }) !== undefined)
};


function parseGithubComment(comment) {
  const tokens = marked.Lexer.lex(comment)
  for (const token of tokens) {
    if (token.type === 'code' && token.lang === 'nim' && token.text.length > 0) {
      return token.text.trim()
    }
  }
};


function parseGithubCommand(comment) {
  let result = comment.trim().split("\n")[0].trim()
  if (result.startsWith("@github-actions nim c") || result.startsWith("@github-actions nim cpp") || result.startsWith("@github-actions nim js") || result.startsWith("@github-actions nim e")) {
    if (result.startsWith("@github-actions nim js")) {
      result = result + " -d:nodejs "
    }
    // if (result.startsWith("@github-actions nim c") || result.startsWith("@github-actions nim cpp")) {
    //   result = result + " --asm --passC:-fno-verbose-asm "
    // }
    result = result.replace("@github-actions", "")
    result = result + extraFlags
    // result = "time " + result
    return result.trim()
  } else {
    core.setFailed("Github comment must start with '@github-actions nim c' or '@github-actions nim cpp' or '@github-actions nim js'")
  }
};


function executeChoosenim(semver) {
  try {
    return execSync(`CHOOSENIM_NO_ANALYTICS=1 choosenim --noColor --skipClean --yes update ${semver}`).toString().trim()
  } catch (error) {
    console.warn(error)
    return ""
  }
}


function executeNim(cmd, codes) {
  if (!fs.existsSync(temporaryFile)) {
    fs.writeFileSync(temporaryFile, codes)
    fs.chmodSync(temporaryFile, "444")
  }
  console.log("COMMAND:\t", cmd)
  try {
    return [true, execSync(cmd).toString().trim()]
  } catch (error) {
    console.warn(error)
    return [false, `${error}`]
  }
}


function executeAstGen(codes) {
  fs.writeFileSync(temporaryFile2, "dumpAstGen:\n" + indentString(codes, 2))
  try {
    return execSync(`nim check --verbosity:0 --hints:off --warnings:off --colors:off --lineTrace:off --import:std/macros ${temporaryFile2}`).toString().trim()
  } catch (error) {
    console.warn(error)
    return ""
  }
}


function getIR() {
  let result = ""
  // Target C
  if (fs.existsSync(temporaryFileAsm)) {
    result = fs.readFileSync(temporaryFileAsm).toString().trim()
  }
  // Target C++
  else if (fs.existsSync(temporaryFileAsm + "pp")) {
    result = fs.readFileSync(temporaryFileAsm + "pp").toString().trim()
  }
  // Target JS
  else if (fs.existsSync(temporaryOutFile)) {
    result = fs.readFileSync(temporaryOutFile).toString().trim()
  }
  // Clean outs
  result = result.split('\n').filter(line => line.trim() !== '').join('\n') // Remove empty lines
  result = result.replace(/\/\*[\s\S]*?\*\//g, '')                          // Remove comments
  return result
}


function gitInit() {
  // Git clone Nim repo and checkout devel
  if (!fs.existsSync(gitTempPath)) {
    console.log(execSync(`git clone https://github.com/nim-lang/Nim.git ${gitTempPath}`))
    console.log(execSync("git checkout devel", {cwd: gitTempPath}))
  }
}


function gitMetadata(commit) {
  // Git get useful metadata from current commit
  execSync(`git checkout ${commit}`, {cwd: gitTempPath})
  const user   = execSync("git log -1 --pretty=format:'%an'", {cwd: gitTempPath}).toString().trim()
  const mesage = execSync("git log -1 --pretty='%B'", {cwd: gitTempPath}).toString().trim()
  const date   = execSync("git log -1 --pretty=format:'%ai'", {cwd: gitTempPath}).toString().trim().toLowerCase()
  const files  = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {cwd: gitTempPath}).toString().trim()
  return [user, mesage, date, files]
}


function gitCommitsBetween(commitOld, commitNew) {
  // Git get all commit short hash between commitOld and commitNew
  return execSync(`git log --pretty=format:'"#%h"' ${commitOld}..${commitNew}`, {cwd: gitTempPath}).toString().trim().toLowerCase().split('\n')
}


function gitCommitForVersion(semver) {
  // Get Git commit for an specific Nim semver
  execSync(`CHOOSENIM_NO_ANALYTICS=1 choosenim --noColor --skipClean --yes update ${semver}`)
  const nimversion = execSync("nim --version").toString().trim().toLowerCase().split('\n').filter(line => line.trim() !== '')
  for (const s of nimversion) {
    if (s.startsWith("git hash:")) {
      return s.replace("git hash:", "").trim()
    }
  }
}


// Only run if this is an "issue_comment" and checkAuthorAssociation.
if (context.eventName === "issue_comment" && checkAuthorAssociation()) {
  const githubToken   = cfg('github-token')
  const githubClient  = new GitHub(githubToken)
  let issueCommentStr = `@${ context.actor } (${ context.payload.comment.author_association.toLowerCase() })`
  // Check if we have permissions.
  if (checkCollaboratorPermissionLevel(githubClient, ['admin', 'write'])) {
    const commentPrefix = "@github-actions nim"
    const githubComment = context.payload.comment.body.trim()
    // Check if github comment starts with commentPrefix.
    if (githubComment.startsWith(commentPrefix)) {
      const codes = parseGithubComment(githubComment)
      const cmd   = parseGithubCommand(githubComment)
      // Add Reaction of "Eyes" as seen.
      if (addReaction(githubClient, "eyes")) {
        // Check the same code agaisnt all versions of Nim from devel to 1.0
        let fails = null
        let works = null
        for (let semver of nimFinalVersions) {
          console.log(executeChoosenim(semver))
          const started  = new Date()  // performance.now()
          const [isOk, output] = executeNim(cmd, codes)
          const finished = new Date()  // performance.now()
          const thumbsUp = (isOk ? ":+1:" : ":-1:")
          if (isOk && works === null) {
            works = semver
          }
          else if (!isOk && fails === null) {
            fails = semver
          }
          // Append to reports
          issueCommentStr += `<details><summary>${semver}\t${thumbsUp}</summary><h3>Output</h3>\n
${ tripleBackticks }
${output}
${ tripleBackticks }\n`
          // Iff Ok add meta info
          if (isOk) {
            issueCommentStr += `<h3>Stats</h3><ul>
<li><b>Created </b>\t<code>${ context.payload.comment.created_at }</code>
<li><b>Started </b>\t<code>${ started.toISOString().split('.').shift()  }</code>
<li><b>Finished</b>\t<code>${ finished.toISOString().split('.').shift() }</code>
<li><b>Duration</b>\t<code>${ formatDuration((((finished - started) % 60000) / 1000).toFixed(0)) }</code>
<li><b>Filesize</b>\t<code>${ formatSizeUnits(getFilesizeInBytes(temporaryOutFile)) }</code>
<li><b>Commands</b>\t<code>${ cmd.replace(preparedFlags, "").trim() }</code></ul>
<h3>AST</h3>\n
${ tripleBackticks }nim
${ executeAstGen(codes) }
${ tripleBackticks }
\n<h3>IR</h3>\n
${ tripleBackticks }cpp
${ getIR() }
${ tripleBackticks }\n`
          }
          issueCommentStr += "</details>\n"
        }


        // This part is about finding the specific commit that breaks
        if (works !== null && fails !== null) {
          // Get a range of commits between "FAILS..WORKS"
          const failsCommit = gitCommitForVersion(fails)
          const worksCommit = gitCommitForVersion(works)
          console.log(`\nfailsCommit =\t${failsCommit}\nworksCommit =\t${worksCommit}\n`)
          gitInit()
          let commits = gitCommitsBetween(worksCommit, failsCommit)
          // iff less than 10 items then we dont care
          while (commits.length > 10) {
            let midIndex = Math.ceil(commits.length / 2)
            console.log(executeChoosenim(commits[midIndex]))
            let [isOk, output] = executeNim(cmd, codes)
            if (isOk) {
              // iff its OK then split 0..mid
              commits = commits.slice(0, midIndex);
            } else {
              // else NOT OK then split mid..end
              commits = commits.slice(midIndex);
            }
          }
          console.log("COMMITS:\t", commits)
          let index = 0
          for (let commit of commits) {
            // Choosenim switch semver
            console.log(executeChoosenim(commit))
            // Run code
            const started  = new Date()  // performance.now()
            const [isOk, output] = executeNim(cmd, codes)
            const finished = new Date()  // performance.now()
            const thumbsUp = (isOk ? ":+1:" : ":-1:")

            if (isOk) {
              const [user, mesage, date, files] = gitMetadata(commits[index - 1])

              issueCommentStr += `<details><summary>${commit}\t${thumbsUp}</summary><h3>Output</h3>\n
${ tripleBackticks }
${output}
${ tripleBackticks }
\n<h3>Diagnostics</h3>
- shorthash ${commit}
- message   ${mesage}
- user      ${user}
- datetime  ${date}
- files     ${files}
</details>\n`
              // Break out of the for
              break
            }
            index++
          }
        // Report results back as a comment on the issue.
        addIssueComment(githubClient, issueCommentStr)
        }
      }
    }
  }
}
