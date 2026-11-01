'use strict';
// Schema 2 is opt-in. Schema 1 keeps its deployed global-build behavior.
// No production feed or Latest pointer is changed by this decoder.
function selectPlatformManifest(manifest, target) {
  if(Number(manifest?.schemaVersion)!==2)return manifest;
  const release=manifest.platforms?.[target];
  if(!release||release.target!==target||!/^\d+\.\d+\.\d+$/.test(String(release.productVersion))||!Number.isSafeInteger(release.buildNumber)||release.buildNumber<1||!release.asset?.sha256?.match(/^[a-f0-9]{64}$/i))throw Error('UPDATE_PLATFORM_MANIFEST_INVALID');
  return {...manifest,...release,assets:{[target]:release.asset},schemaVersion:2};
}
module.exports={selectPlatformManifest};
