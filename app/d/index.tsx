import { Redirect } from 'expo-router';

// Web parity: the Killio frontend uses /d for the documents browser. Mobile
// keeps the canonical screen at /documents, but we accept /d as a deep link
// alias so links shared between web and Vault land in the same place.
export default function DocsAlias() {
  return <Redirect href="/documents" />;
}
