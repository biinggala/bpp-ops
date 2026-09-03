// 쿠키 한 장 읽고 쓰기. 의존성 없이.
//
// 로그인 요청을 **시작한 브라우저**에서만 끝낼 수 있게 하는 데 씁니다. 구글로
// 보내는 주소를 복사해 남에게 넘기면, 그 사람의 브라우저에는 이 쿠키가 없어서
// 콜백이 거절됩니다. 같은 브라우저의 최상위 이동에는 SameSite=Lax로 실립니다.

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function cookieHeader(name: string, value: string, opts: { maxAge: number; path: string; secure: boolean }): string {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Max-Age=${opts.maxAge}`, `Path=${opts.path}`, 'HttpOnly', 'SameSite=Lax']
  if (opts.secure) bits.push('Secure')
  return bits.join('; ')
}
