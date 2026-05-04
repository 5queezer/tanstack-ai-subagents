import { routeSubagentRequest } from '../dist/index.js'

const note = routeSubagentRequest('Review frontend and backend independently')

console.log(note.chosenAction)
console.log(note.rationale)
