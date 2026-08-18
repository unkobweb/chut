/**
 * Suite de tests d'attaque.
 * Chaque bloc reproduit une attaque reelle et doit ECHOUER avant correction.
 *
 * Usage: node test/attacks.mjs
 */
import {
  startServer, api, createRequest, fillRequest, concurrentPost, KEY,
  check, section, report,
} from './harness.mjs'

const proc = await startServer()

// =============================================================================
section('01 · Course sur le burn : la revelation doit etre atomique')
// =============================================================================
// L'agent revele une seule fois : le secret est detruit a la lecture. Le burn est
// aussi le detecteur d'intrusion — si un voleur lit avant l'agent, l'agent recoit
// un 409 et l'incident devient visible. Un attaquant qui lance ses requetes EN MEME
// TEMPS que l'agent legitime ne doit pas pouvoir obtenir le secret en plus de lui.
{
  const CONCURRENT = 10
  const ROUNDS = 5
  const outcomes = []

  // Plusieurs manches : une course ne se gagne pas a tous les coups, mais le
  // comportement attendu ("exactement un gagnant") doit tenir a CHAQUE manche.
  for (let round = 0; round < ROUNDS; round++) {
    const SECRET = `sk-live-course-${round}`
    const req = await createRequest({ label: 'Cle bancaire' })
    await fillRequest(req, SECRET)

    const responses = await concurrentPost(
      `/v1/requests/${req.id}/reveal`,
      { poll_token: req.poll_token, encryption_key: req.encryption_key },
      { authorization: `Bearer ${KEY}` },
      CONCURRENT,
    )

    outcomes.push({
      req,
      winners: responses.filter((r) => r.body.secret === SECRET).length,
      rejected: responses.filter((r) => r.status === 409).length,
      leaked: responses.filter((r) => r.status !== 200 && r.body.secret !== undefined).length,
    })
  }

  const worst = Math.max(...outcomes.map((o) => o.winners))
  check(
    `un seul appel obtient le secret, sur ${ROUNDS} manches de ${CONCURRENT} requetes simultanees`,
    outcomes.every((o) => o.winners === 1),
    `jusqu'a ${worst} appels ont recu le secret dans une meme manche ` +
      `(detail: ${outcomes.map((o) => o.winners).join(', ')})`,
  )
  check(
    'tous les perdants sont rejetes en 409',
    outcomes.every((o) => o.winners + o.rejected === CONCURRENT),
    `manches incompletes: ${outcomes.map((o) => `${o.winners}+${o.rejected}`).join(', ')}`,
  )
  check(
    'aucune reponse non-200 ne contient de secret',
    outcomes.every((o) => o.leaked === 0),
  )

  const last = outcomes.at(-1).req
  const after = await (
    await api(`/v1/requests/${last.id}`, { headers: { 'x-poll-token': last.poll_token } })
  ).json()
  check('la demande est marquee revealed apres la course', after.status === 'revealed', after.status)

  const late = await api(`/v1/requests/${last.id}/reveal`, {
    method: 'POST',
    body: JSON.stringify({ poll_token: last.poll_token, encryption_key: last.encryption_key }),
  })
  check('une revelation tardive est refusee', late.status === 409, `recu ${late.status}`)
}

report(proc)
