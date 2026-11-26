// RG: substituto do stdafx.h (MFC) para compilar só o áudio do Dn-FamiTracker fora do Windows
#pragma once
#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
#ifndef ASSERT
#define ASSERT(x) assert(x)
#endif
#ifndef TRACE
#define TRACE(...) ((void)0)
#endif
#define SAFE_RELEASE(p) if (p != NULL) { delete p; p = NULL; }
#define SAFE_RELEASE_ARRAY(p) if (p != NULL) { delete [] p; p = NULL; }
#define CALL_MEMBER_FN(obj, ptr) ((obj)->*(ptr))
typedef unsigned int UINT32;
typedef unsigned int UINT;
#define AfxDebugBreak() ((void)0)
