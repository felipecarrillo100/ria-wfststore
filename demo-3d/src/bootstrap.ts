import { setLicenseText } from '@luciad/ria/util/License.js'
import licenseText from './license/luciadria_development.txt?raw'

setLicenseText(licenseText)

import('./main.tsx')
