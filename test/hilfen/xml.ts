// The XML parser the tests use in place of the browser's: xmldom. Its `DOMParser`, `XMLSerializer` and
// nodes have types of their own, which the DOM types of the engine (`Document`, `Element`) do not accept
// although they behave alike for everything the engine reads and writes. This is the one place that says
// so, with one cast each (hence `unknown` in between: the two class types do not overlap enough for a
// plain `as`); the tests import from here and need no cast of their own.
import { DOMParser as XmlDomParser, XMLSerializer as XmlDomSerializer } from '@xmldom/xmldom'

/** xmldom's parser, as the engine's injection point (`typeof globalThis.DOMParser`) wants it. */
export const DOMParser = XmlDomParser as unknown as typeof globalThis.DOMParser

/** xmldom's serializer, as the engine's injection point (`typeof globalThis.XMLSerializer`) wants it. */
export const XMLSerializer = XmlDomSerializer as unknown as typeof globalThis.XMLSerializer

/** The document of an XML text. */
export function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml')
}
