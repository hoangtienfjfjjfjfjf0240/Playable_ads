import { redirect } from 'next/navigation';

type ClonePlayableV2PageProps = {
  params: Promise<{ appId: string }>;
};

export default async function ClonePlayableV2Page({ params }: ClonePlayableV2PageProps) {
  const { appId } = await params;
  redirect(`/v2/apps/${appId}`);
}
