import { NextRequest, NextResponse } from "next/server"; import { destroySession } from "@/lib/auth"; import { assertSameOrigin } from "@/lib/http";
export async function POST(req:NextRequest){const originDenied=assertSameOrigin(req);if(originDenied)return originDenied;await destroySession();return NextResponse.json({ok:true});}
