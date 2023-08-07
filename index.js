'use strict';
const fs       = require('fs')
const os       = require('os')
const path     = require('path')
const core     = require('@actions/core')
const marked   = require('marked')
const { execSync } = require('child_process')
const {context, GitHub} = require('@actions/github')


const startedDatetime  = new Date()
const tripleBackticks  = "```"
const gitTempPath      = `${ process.cwd() }/Nim`
const temporaryFile    = `${ process.cwd() }/temp.nim`
const temporaryFile2   = `${ process.cwd() }/dumper.nim`
const temporaryFileAsm = `${ process.cwd() }/@mtemp.nim.c`
const temporaryOutFile = temporaryFile.replace(".nim", "")
const extraFlags       = ` -d:nimDebugDlOpen -d:ssl -d:nimDisableCertificateValidation --forceBuild:on --colors:off --verbosity:0 --hints:off --warnings:off --styleCheck:off --lineTrace:off --nimcache:${ process.cwd() } --out:${temporaryOutFile} ${temporaryFile}`
const nimFinalVersions = ["devel", "stable", "2.0.0", "1.6.0", "1.4.0", "1.2.0", "1.0.0", "0.20.2"]
const choosenimNoAnal  = {env: {...process.env, CHOOSENIM_NO_ANALYTICS: "1", SOURCE_DATE_EPOCH: Math.floor(Date.now() / 1000).toString()}}  // SOURCE_DATE_EPOCH is same in all runs.
const valgrindLeakChck = {env: {...process.env, VALGRIND_OPTS: "--tool=memcheck --leak-check=full --show-leak-kinds=all --undef-value-errors=yes --track-origins=yes --show-error-list=yes --keep-debuginfo=yes --show-emwarns=yes --demangle=yes --smc-check=none --num-callers=9 --max-threads=9"}}
const debugGodModes    = ["araq"]
const unlockedAllowAll = true  // true == Users can Bisect  |  false == Only Admins can Bisect.
const commentPrefixes  = ["!nim "]


function cfg(key) {
  console.assert(typeof key === "string", `key must be string, but got ${ typeof key }`)
  const result = core.getInput(key, {required: true}).trim()
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result;
};


function shuffleArray(arrai) {
  console.assert(arrai.length > 0, `arrai must not be empty array, but got ${ arrai }`)
  const result = [...arrai]
  for (let i = result.length - 1; i > 0; i--) {
    [result[i], result[Math.floor(Math.random() * (i + 1))]] = [result[Math.floor(Math.random() * (i + 1))], result[i]]
  }
  return result
}


function fuzzFloat() {
  return shuffleArray([-0.0, 2.718281828459045, 3.141592653589793, 6.283185307179586, 2.225073858507201e-308])[0]
}


function fuzzBool() {
  return shuffleArray([true, false])[0]
}


function fuzzInt64() {
  return shuffleArray([-9223372036854775808n, -2147483648, -32768, -128, 0, 127, 255, 32767, 65535, 2147483647, 4294967295, 9223372036854775807n])[0]
}


function fuzzInt() {
  return fuzzInt64()
}


function fuzzInt32() {
  return shuffleArray([-2147483648, -32768, -128, 0, 127, 255, 32767, 65535, 2147483647])[0]
}


function fuzzInt16() {
  return shuffleArray([-32768, -128, 0, 127, 255, 32767])[0]
}


function fuzzInt8() {
  return shuffleArray([-128, 0, 127])[0]
}


function fuzzUint64() {
  return shuffleArray([0, 127, 255, 32767, 65535, 2147483647, 4294967295, 9223372036854775807n, 18446744073709551614n])[0]
}


function fuzzUint32() {
  return shuffleArray([0, 127, 255, 32767, 65535, 2147483647, 4294967295])[0]
}

function fuzzUint16() {
  return shuffleArray([0, 127, 255, 32767, 65535])[0]
}

function fuzzUint8() {
  return shuffleArray([0, 127, 255])[0]
}


function fuzzChar() {
  return Math.floor(Math.random() * 256)
}


function fuzzString() {
  let result = shuffleArray([
    "", " ", "\t", "\0", "1/0", "-0", "NaN", "''", "``", "-1E+02", "0..0",
    "0x0", "undefined", "null", "nil", "()", "{0}", "%*.*s", "%@", "%n",
    "CON", "PRN", "AUX", "NUL", "COM1", "LPT1", "జ్ఞ‌ా", "گچپژ", "%s%s%s%s%s",
    "$HOME", "\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
    "ЁЂЃЄЅІЇЈЉЊЋЌЍЎЏАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя",
    ",。・:*:・゜’( ☻ ω ☻ )。・:*:・゜’",
    "Ｔｈｅ ｑｕｉｃｋ ｂｒｏｗｎ ｆｏｘ ｊｕｍｐｓ ｏｖｅｒ ｔｈｅ ｌａｚｙ ｄｏｇ",
    "𝐓𝐡𝐞 𝐪𝐮𝐢𝐜𝐤 𝐛𝐫𝐨𝐰𝐧 𝐟𝐨𝐱 𝐣𝐮𝐦𝐩𝐬 𝐨𝐯𝐞𝐫 𝐭𝐡𝐞 𝐥𝐚𝐳𝐲 𝐝𝐨𝐠",
    "𝕿𝖍𝖊 𝖖𝖚𝖎𝖈𝖐 𝖇𝖗𝖔𝖜𝖓 𝖋𝖔𝖝 𝖏𝖚𝖒𝖕𝖘 𝖔𝖛𝖊𝖗 𝖙𝖍𝖊 𝖑𝖆𝖟𝖞 𝖉𝖔𝖌",
    "𝑻𝒉𝒆 𝒒𝒖𝒊𝒄𝒌 𝒃𝒓𝒐𝒘𝒏 𝒇𝒐𝒙 𝒋𝒖𝒎𝒑𝒔 𝒐𝒗𝒆𝒓 𝒕𝒉𝒆 𝒍𝒂𝒛𝒚 𝒅𝒐𝒈",
    "𝓣𝓱𝓮 𝓺𝓾𝓲𝓬𝓴 𝓫𝓻𝓸𝔀𝓷 𝓯𝓸𝔁 𝓳𝓾𝓶𝓹𝓼 𝓸𝓿𝓮𝓻 𝓽𝓱𝓮 𝓵𝓪𝔃𝔂 𝓭𝓸𝓰",
    "𝕋𝕙𝕖 𝕢𝕦𝕚𝕔𝕜 𝕓𝕣𝕠𝕨𝕟 𝕗𝕠𝕩 𝕛𝕦𝕞𝕡𝕤 𝕠𝕧𝕖𝕣 𝕥𝕙𝕖 𝕝𝕒𝕫𝕪 𝕕𝕠𝕘",
    "𝚃𝚑𝚎 𝚚𝚞𝚒𝚌𝚔 𝚋𝚛𝚘𝚠𝚗 𝚏𝚘𝚡 𝚓𝚞𝚖𝚙𝚜 𝚘𝚟𝚎𝚛 𝚝𝚑𝚎 𝚕𝚊𝚣𝚢 𝚍𝚘𝚐",
    "The quic\b\b\b\b\b\bk brown fo\u0007\u0007\u0007\u0007\u0007\u0007\u0007\u0007\u0007\u0007\u0007x",
    "⒯⒣⒠ ⒬⒰⒤⒞⒦ ⒝⒭⒪⒲⒩ ⒡⒪⒳ ⒥⒰⒨⒫⒮ ⒪⒱⒠⒭ ⒯⒣⒠ ⒧⒜⒵⒴ ⒟⒪⒢",
    "0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟",
    "בְּרֵאשִׁית, בָּרָא אֱלֹהִים, אֵת הַשָּׁמַיִם, וְאֵת הָאָרֶץ",
    "Ṱ̺̺̕o͞ ̷i̲̬͇̪͙n̝̗͕v̟̜̘̦͟o̶̙̰̠kè͚̮̺̪̹̱̤ ̖t̝͕̳̣̻̪͞h̼͓̲̦̳̘̲e͇̣̰̦̬͎ ̢̼̻̱̘h͚͎͙̜̣̲ͅi̦̲̣̰̤v̻͍e̺̭̳̪̰-m̢iͅn̖̺̞̲̯̰d̵̼̟͙̩̼̘̳ ̞̥̱̳̭r̛̗̘e͙p͠r̼̞̻̭̗e̺̠̣͟s̘͇̳͍̝͉e͉̥̯̞̲͚̬͜ǹ̬͎͎̟̖͇̤t͍̬̤͓̼̭͘ͅi̪̱n͠g̴͉ ͏͉ͅc̬̟h͡a̫̻̯͘o̫̟̖͍̙̝͉s̗̦̲.̨̹͈̣",
    "٠١٢٣٤٥٦٧٨٩",
    "田中さんにあげて下さい",
    "パーティーへ行かないか",
    "﷽",
    "和製漢語",
    "部落格",
    "사회과학원 어학연구소",
  ])[0]
  result = `"""${ result }"""`
  return result
}


function fuzz() {
  let result = `const
  nimFuzzFloat*    = float(   ${ fuzzFloat()    })
  nimFuzzFloat64*  = float64( ${ fuzzFloat()    })
  nimFuzzFloat32*  = float32( ${ fuzzFloat()    })
  nimFuzzBool*     = bool(    ${ fuzzBool()     })
  nimFuzzInt*      = int(     ${ fuzzInt64()    })
  nimFuzzInt64*    = int64(   ${ fuzzInt64()    })
  nimFuzzInt32*    = int32(   ${ fuzzInt32()    })
  nimFuzzInt16*    = int16(   ${ fuzzInt16()    })
  nimFuzzInt8*     = int8(    ${ fuzzInt8()     })
  nimFuzzUint*     = uint(    ${ fuzzUint64()   })
  nimFuzzUint64*   = uint64(  ${ fuzzUint64()   })
  nimFuzzUint32*   = uint32(  ${ fuzzUint32()   })
  nimFuzzUint16*   = uint16(  ${ fuzzUint16()   })
  nimFuzzUint8*    = uint8(   ${ fuzzUint8()    })
  nimFuzzByte*     = byte(    ${ fuzzUint8()    })
  nimFuzzPositive* = Positive(${ fuzzUint32()+1 })
  nimFuzzNatural*  = Natural( ${ fuzzUint32()   })
  nimFuzzString*   = string(  ${ fuzzString()   })
  nimFuzzChar*     = char(    ${ fuzzChar()     })
`
  console.log(`FUZZINGS = ${ result }`)
  return result
}


function indentString(str, count = 2, indent = ' ') {
  return str.replace(/^/gm, indent.repeat(count))
}


function formatDuration(seconds) {
  if (typeof seconds === "string") {
    seconds = parseInt(seconds, 10)
  }
  console.assert(typeof seconds === "number", `seconds must be number, but got ${ typeof seconds }`)
  let result = "now"
  if (!isNaN(seconds) && seconds > 0) {
      const hours   = Math.floor(((seconds % 31536000) % 86400) / 3600);
      const minutes = Math.floor(((seconds % 31536000) % 86400) %  60);
      const second  = (((seconds % 31536000) % 86400)  % 3600)  % 0;
      const y = (hours   > 0) ? hours   + " hours"   : "";
      const z = (minutes > 0) ? minutes + " minutes" : "";
      const u = (second  > 0) ? second  + " seconds" : "";
      result = y + z + u
  }
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result
}


function formatSizeUnits(bytes) {
  console.assert(typeof bytes === "number", `bytes must be number, but got ${ typeof bytes }`)
  const bites = ` (${ bytes.toLocaleString() } bytes)`
  if      (bytes >= 1073741824) { bytes = (bytes / 1073741824).toFixed(2) + " Gb"; }
  else if (bytes >= 1048576)    { bytes = (bytes / 1048576).toFixed(2) + " Mb"; }
  else if (bytes >= 1024)       { bytes = (bytes / 1024).toFixed(2) + " Kb"; }
  else if (bytes >  1)          { bytes = bytes + " bytes"; }
  else if (bytes == 1)          { bytes = bytes + " byte"; }
  else                          { bytes = "0 bytes"; }
  return bytes + bites;
}


function getFilesizeInBytes(filename) {
  console.assert(typeof filename === "string", `filename must be string, but got ${ typeof filename }`)
  let result = (fs.existsSync(filename)) ? fs.statSync(filename).size : 0
  console.assert(typeof result === "number", `result must be number, but got ${ typeof filename }`)
  return result
}


function checkAuthorAssociation() {
  const authorPerm = context.payload.comment.author_association.trim().toLowerCase()
  let result = (authorPerm === "owner" || authorPerm === "collaborator" || authorPerm === "member" || debugGodModes.includes(context.payload.comment.user.login.toLowerCase()))
  console.assert(typeof result === "boolean", `result must be boolean, but got ${ typeof result }`)
  return result
};


function hasArc(cmd) {
  console.assert(typeof cmd === "string", `cmd must be string, but got ${ typeof cmd }`)
  const s = cmd.trim().toLowerCase()
  return (s.includes("--gc:arc") || s.includes("--gc:orc") || s.includes("--gc:atomicarc") || s.includes("--mm:arc") || s.includes("--mm:orc") || s.includes("--mm:atomicarc"))
}


function hasMalloc(cmd) {
  console.assert(typeof cmd === "string", `cmd must be string, but got ${ typeof cmd }`)
  const s = cmd.trim().toLowerCase()
  return (s.includes("-d:usemalloc") || s.includes("--define:usemalloc"))
}


function versionInfos() {
  return [
    execSync("gcc --version").toString().split("\n")[0].replace("gcc", "").trim(),
    execSync("ldd --version").toString().split("\n")[0].replace("ldd", "").trim(),
    execSync("valgrind --version").toString().split("\n")[0].replace("valgrind-", "").trim(),
    execSync("node --version").toString().split("\n")[0].replace("v", "").trim(),
    execSync("uname --kernel-release").toString().split("\n")[0].replace("azure", "").trim(),
  ]
}


async function addReaction(githubClient, reaction) {
  console.assert(typeof reaction === "string", `reaction must be string, but got ${ typeof reaction }`)
  return (await githubClient.reactions.createForIssueComment({
    comment_id: context.payload.comment.id,
    content   : reaction.trim().toLowerCase(),
    owner     : context.repo.owner,
    repo      : context.repo.repo,
  }) !== undefined)
};


async function addIssueComment(githubClient, issueCommentBody) {
  console.assert(typeof issueCommentBody === "string", `issueCommentBody must be string, but got ${ typeof issueCommentBody }`)
  return (await githubClient.issues.createComment({
    issue_number: context.issue.number,
    owner       : context.repo.owner,
    repo        : context.repo.repo,
    body        : issueCommentBody.trim(),
  }) !== undefined)
};


function parseGithubComment(comment) {
  console.assert(typeof comment === "string", `comment must be string, but got ${ typeof comment }`)
  const tokens = marked.Lexer.lex(comment)
  const allowedFileExtensions = ["c", "cpp", "c++", "h", "hpp", "js"]
  let result = ""
  for (const token of tokens) {
    if (token.type === 'code' && token.text.length > 0 && token.lang !== undefined) {
      if (token.lang === 'nim') {
        result = token.text.trim()
        result = result.split('\n').filter(line => line.trim() !== '').join('\n')
      } else if (allowedFileExtensions.includes(token.lang)) {
        const xtraFile = `${ process.cwd() }/temp.${token.lang}`
        if (!fs.existsSync(xtraFile)) {
          fs.writeFileSync(xtraFile, token.text.trim())
          fs.chmodSync(xtraFile, "444")
        }
      } else if (token.lang === 'cfg' || token.lang === 'ini') {
        const xtraFile = `${ temporaryFile }.cfg`
        if (!fs.existsSync(xtraFile)) {
          fs.writeFileSync(xtraFile, token.text.trim())
          fs.chmodSync(xtraFile, "444")
        }
      }
    }
  }
  return result
}


function parseGithubCommand(comment) {
  console.assert(typeof comment === "string", `comment must be string, but got ${ typeof comment }`)
  let result = comment.trim().split("\n")[0].trim()
  // Basic checkings
  const bannedSeps = [";", "&&", "||"]
  if (bannedSeps.some(s => result.includes(s))) {
    core.setFailed(`Github comment must not contain ${bannedSeps}`)
  }
  if (!result.startsWith("!nim c") && !result.startsWith("!nim cpp") && !result.startsWith("!nim js")) {
    core.setFailed("Github comment must start with '!nim c' or '!nim cpp' or '!nim js'")
  }
  // Extra arguments based on different targets
  if (result.startsWith("!nim js")) {
    result = result + " -d:nodejs -d:nimExperimentalAsyncjsThen -d:nimExperimentalJsfetch "
  }
  const useArc      = hasArc(result)
  const useValgrind = useArc && hasMalloc(result)
  if (useArc) {
    result = result + " -d:nimArcDebug -d:nimArcIds "
  }
  if (useValgrind) {
    result = result + " -d:nimAllocPagesViaMalloc -d:useSysAssert -d:useGcAssert -d:nimLeakDetector --debugger:native --debuginfo:on "
  } else {
    result = result + " --run "
  }
  result = result + extraFlags
  if (useValgrind) {
    result = result + ` && valgrind ${temporaryOutFile}`
  }
  result = result.substring(1) // Remove the leading "!"
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result.trim()
};


function executeChoosenim(semver) {
  console.assert(typeof semver === "string", `semver must be string, but got ${ typeof semver }`)
  for (let i = 0; i < 3; i++) {
    try {
      const result = execSync(`choosenim --noColor --skipClean --yes update "${semver}"`, choosenimNoAnal).toString().trim()
      if (result) {
        return result
      }
    } catch (error) {
      console.warn(error)
      if (i === 2) {
        console.warn('choosenim failed >3 times, giving up...')
        return ""
      }
    }
  }
}


function executeNim(cmd, codes) {
  console.assert(typeof cmd === "string", `cmd must be string, but got ${ typeof cmd }`)
  console.assert(typeof codes === "string", `codes must be string, but got ${ typeof codes }`)
  // if (!fs.existsSync(temporaryFile)) {
  fs.writeFileSync(temporaryFile, fuzz() + codes)
  // fs.chmodSync(temporaryFile, "444")
  // }
  console.log("COMMAND:\t", cmd)
  try {
    return [true, execSync(cmd, valgrindLeakChck).toString().trim()]
  } catch (error) {
    console.warn(error)
    return [false, `${error}`]
  }
}


function executeAstGen(codes) {
  console.assert(typeof codes === "string", `codes must be string, but got ${ typeof codes }`)
  fs.writeFileSync(temporaryFile2, `dumpAstGen:\n${ indentString(codes) }`)
  try {
    return execSync(`nim check --verbosity:0 --hints:off --warnings:off --colors:off --lineTrace:off --forceBuild:on --import:std/macros ${temporaryFile2}`).toString().trim()
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
  result = result.replace(/\/\*[\s\S]*?\*\//g, '').trim()                   // Remove comments
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result
}


function gitInit() {
  // Git clone Nim repo and checkout devel
  if (!fs.existsSync(gitTempPath)) {
    console.log(execSync(`git clone https://github.com/nim-lang/Nim.git ${gitTempPath}`).toString())
    console.log(execSync("git config --global advice.detachedHead false && git checkout devel", {cwd: gitTempPath}).toString())
  }
}


function gitMetadata(commit) {
  // Git get useful metadata from current commit
  console.assert(typeof commit === "string", `commit must be string, but got ${ typeof commit }`)
  console.log(execSync(`git checkout ${ commit.replace("#", "") }`, {cwd: gitTempPath}).toString())
  const user   = execSync("git log -1 --pretty=format:'%an'", {cwd: gitTempPath}).toString().trim().toLowerCase()
  const mesage = execSync("git log -1 --pretty='%B'", {cwd: gitTempPath}).toString().trim()
  const date   = execSync("git log -1 --pretty=format:'%ai'", {cwd: gitTempPath}).toString().trim().toLowerCase()
  const files  = execSync("git diff-tree --no-commit-id --name-only -r HEAD", {cwd: gitTempPath}).toString().trim()
  return [user, mesage, date, files]
}


function gitCommitsBetween(commitOld, commitNew) {
  // Git get all commit short hash between commitOld and commitNew
  console.assert(typeof commitOld === "string", `commitOld must be string, but got ${ typeof commitOld }`)
  console.assert(typeof commitNew === "string", `commitNew must be string, but got ${ typeof commitNew }`)
  const result = execSync(`git log --pretty=format:'#%h' ${commitOld}..${commitNew}`, {cwd: gitTempPath}).toString().trim().toLowerCase()
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result.split('\n')
}


function gitCommitForVersion(semver) {
  // Get Git commit for an specific Nim semver
  console.assert(typeof semver === "string", `semver must be string, but got ${ typeof semver }`)
  let result = null
  semver     = semver.trim().toLowerCase()
  if (semver === "2.0.0") {
    result = "a488067"
  } else if (semver === "1.6.0") {
    result = "727c637"
  } else if (semver === "1.4.0") {
    result = "018ae96"
  } else if (semver === "1.2.0") {
    result = "7e83adf"
  } else if (semver === "1.0.0") {
    result = "f7a8fc4"
  } else if (semver === "0.20.2") {
    result = "88a0edb"
  } else if (semver === "devel" || semver === "stable") {
    // For semver === "devel" or semver === "stable" we use choosenim
    executeChoosenim(semver) // devel and stable are moving targets.
    const nimversion = execSync("nim --version").toString().trim().toLowerCase().split('\n').filter(line => (typeof line === "string" && line.trim() !== ''))
    for (const s of nimversion) {
      if (s.startsWith("git hash:")) {
        result = s.replace("git hash:", "").trim().toLowerCase()
        break
      }
    }
  } else {
    // For semver == "x.x.x" we use Git
    result = execSync(`git checkout "v${semver}" && git rev-parse --short HEAD`, {cwd: gitTempPath}).toString().trim().toLowerCase()
    execSync(`git checkout devel`, {cwd: gitTempPath}) // Go back to devel
  }
  console.assert(typeof result === "string", `result must be string, but got ${ typeof result }`)
  return result
}


// Only run if this is an "issue_comment" and comment startsWith commentPrefixes.
if (context.eventName === "issue_comment" && commentPrefixes.some(prefix => context.payload.comment.body.trim().toLowerCase().startsWith(prefix)) && (unlockedAllowAll || checkAuthorAssociation()) ) {
  // Check if we have permissions.
  const githubClient  = new GitHub(cfg('github-token'))
  // Add Reaction of "Eyes" as seen.
  if (addReaction(githubClient, "eyes")) {
    const githubComment = context.payload.comment.body.trim()
    const codes         = parseGithubComment(githubComment)
    const cmd           = parseGithubCommand(githubComment)
    let fails           = null
    let works           = null
    let commitsLen      = nimFinalVersions.length
    let issueCommentStr = `@${ context.actor } (${ context.payload.comment.author_association.toLowerCase() })`
    // Check the same code agaisnt all versions of Nim from devel to 1.0
    for (let semver of nimFinalVersions) {
      console.log(executeChoosenim(semver))
      const started  = new Date()
      let [isOk, output] = executeNim(cmd, codes)
      const finished = new Date()
      const thumbsUp = (isOk ? " :+1: $\\color{green}\\textbf{\\large OK}$ " : " :-1: FAIL ")
      // Remember which version works and which version breaks.
      if (isOk && works === null) {
        works = semver
      }
      else if (!isOk && fails === null) {
        fails = semver
      }
      // Append to reports.
      issueCommentStr += `<details><summary><kbd>${semver}</kbd>\t${thumbsUp}</summary><h3>Output</h3>\n
${ tripleBackticks }
${ output.replace(/^==\d+== /gm, '').trim() }
${ tripleBackticks }\n
<h3>Stats</h3><ul>
<li><b>Started</b>\t<code>${ started.toISOString().split('.').shift()  }</code>
<li><b>Finished</b>\t<code>${ finished.toISOString().split('.').shift() }</code>
<li><b>Duration</b>\t<code>${ formatDuration((((finished - started) % 60000) / 1000)) }</code></ul>\n`
      // Iff NOT Ok add AST and IR info for debugging purposes.
      if (!isOk) {
        issueCommentStr += `
<h3>IR</h3><b>Compiled filesize</b>\t<code>${ formatSizeUnits(getFilesizeInBytes(temporaryOutFile)) }</code>\n
${ tripleBackticks }cpp
${ getIR() }
${ tripleBackticks }\n
<h3>AST</h3>\n
${ tripleBackticks }nim
${ executeAstGen(codes) }
${ tripleBackticks }\n`
      }
      issueCommentStr += "</details>\n"
    }


    // This part is about finding the specific commit that breaks
    if (fails !== null && works !== null) {
      // Get a range of commits between "FAILS..WORKS"
      gitInit()
      const failsCommit = gitCommitForVersion(fails)
      const worksCommit = gitCommitForVersion(works)
      if (failsCommit !== null && worksCommit !== null) {
        let commits = gitCommitsBetween(worksCommit, failsCommit)
        commitsLen += commits.length
        // Split commits in half and check if that commit works or fails,
        // then repeat the split there until we got less than 10 commits.
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
        let commitsNear = "\n<ul>"
        for (let commit of commits) {
          commitsNear += `<li><a href=https://github.com/nim-lang/Nim/commit/${ commit.replace("#", "") } >${ commit }</a>\n`
        }
        commitsNear += "</ul>\n"
        let bugFound = false
        let index = 0
        for (let commit of commits) {
          // Choosenim switch semver
          console.log(executeChoosenim(commit))
          // Run code
          const [isOk, output] = executeNim(cmd, codes)
          // if this commit works, then previous commit is the breakingCommit
          if (isOk) {
            if (!bugFound) {
              bugFound = true
            }
            const breakingCommit = (index > 0) ? commits[index - 1] : commits[index]
            const [user, mesage, date, files] = gitMetadata(breakingCommit)
            const comit = breakingCommit.replace('"', '')
            // Report the breaking commit diagnostics
            issueCommentStr += `<details><summary><kbd>${comit}</kbd> :arrow_right: :bug:</summary><h3>Diagnostics</h3>\n
${user} introduced a bug at <code>${date}</code> on commit <a href=https://github.com/nim-lang/Nim/commit/${ comit.replace("#", "") } >${ comit }</a> with message:\n
${ tripleBackticks }
${mesage}
${ tripleBackticks }
\nThe bug is in the files:\n
${ tripleBackticks }
${files}
${ tripleBackticks }
\nThe bug can be in the commits:\n
${commitsNear}
(Diagnostics sometimes off-by-one).</details>\n`
            // Break out of the for
            break
          }
          index++
        }
        if (!bugFound) {
          issueCommentStr += `<details><summary>??? :arrow_right: :bug:</summary><h3>Diagnostics</h3>\n
The commit that introduced the bug can not be found, but the bug is in the commits:
${commitsNear}
(Can not find the commit because Nim can not be re-built commit-by-commit to bisect).\n</details>\n`
        }
      }
      else { console.warn("failsCommit and worksCommit not found, at least 1 working commit and 1 non-working commit are required for Bisect commit-by-commit.") }
    }
    else { console.warn("works and fails not found, at least 1 working commit and 1 non-working commit are required for Bisect commit-by-commit.") }
    // Report results back as a comment on the issue.
    const duration = ((( (new Date()) - startedDatetime) % 60000) / 1000)
    const v = versionInfos()
    issueCommentStr += `<details><summary>Stats</summary><ul>
<li><b>GCC     </b>\t<code>${ v[0] }</code>
<li><b>LibC    </b>\t<code>${ v[1] }</code>
<li><b>Valgrind</b>\t<code>${ v[2] }</code>
<li><b>NodeJS  </b>\t<code>${ v[3] }</code>
<li><b>Linux   </b>\t<code>${ v[4] }</code>
<li><b>Created </b>\t<code>${ context.payload.comment.created_at }</code>
<li><b>Issue Comments</b>\t<code>${ context.payload.issue.comments }</code>
<li><b>Commands</b>\t<code>${ cmd }</code></ul></details>\n
:robot: Bug found in <code>${ formatDuration(duration) }</code> bisecting <code>${commitsLen}</code> commits at <code>${ Math.round(commitsLen / duration) }</code> commits per second.`
    addIssueComment(githubClient, issueCommentStr)
  }
  else { console.warn("githubClient.addReaction failed, repo permissions error?.") }
}
